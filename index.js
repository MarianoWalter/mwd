const Request = require('request');
const EventEmitter = require('events').EventEmitter;
const fs = require('fs');
const FSUtils = require('./fs-utils');

module.exports = MWDownload;

// TODO si es servidor no soporta el header Range o el tamaño de bloque es mayor al tamaño del archivo usar streams/pipes

/**
 * @param { Object } opts
 * @param { string|URL } opts.url URL de origen del archivo
 * @param { import('fs').PathLike } opts.file Ruta al archivo destino
 * @param { number? } opts.blockSize Tamaño de cada bloque
 */
function MWDownload(opts = {}) {
	let emitter = new EventEmitter();

	opts.blockSize = parseInt(opts.blockSize) > 0 ? parseInt(opts.blockSize) : (1024 * 1024 * 4); // 4 Mb por defecto

	this.on = (event, listener) => emitter.on(event, listener);
	this.off = (event, listener) => emitter.off(event, listener);

	this.dispose = () => {
		emitter.removeAllListeners();
		emitter = null;
	};

	this.start = async () => {
		let fd = null, initData, metadata, mwdFileInfo;

		emitter.emit('start', {});

		try {

			try {
				/** @type { { fileSize:number, serverAcceptRange:boolean } } */
				initData = await initialFetch(opts.url);
				emitter.emit('initial_data', copy(initData));

				// TODO Si initData.serverAcceptRange es false throw error?
			} catch (e) {
				emitter.emit('error_request', e);
				throw e;
			}

			// Carga/crea el archivo
			try {
				// Renombrar el archivo con la extensión .mwd
				if (!/\.mwd$/.test(opts.file)) {
					/* eslint-disable-next-line require-atomic-updates */
					opts.file += '.mwd';
				}

				mwdFileInfo = await createMWDFile(opts.file);
				fd = mwdFileInfo.fd;

				if (mwdFileInfo.justCreated) {
					emitter.emit('file_created', { fd, size: initData.fileSize });
				}

				emitter.emit('file_loaded', { size: initData.fileSize, ...copy(mwdFileInfo) });
			} catch (e) {
				emitter.emit('error', new Error('Error creating the file'));
				throw e;
			}

			let corruptedMetadata = false;
			if (mwdFileInfo.alreadyExists) {
				// Si el archivo ya existía se cargan sus metadatos
				try {
					metadata = await readMetadata(opts.file);
				} catch (e) {
					// Datos corruptos
					corruptedMetadata = true;
					emitter.emit('corrupt_metadata', {});
				}

				// TODO check metadata.initialSize == initData.fileSize (from HEAD request)

				if (!corruptedMetadata) {
					await updateMetadata(fd, metadata);
				}
			}

			// Si el archivo está recién creado todavía no tiene metadatos o si están corruptos/vacíos
			if (mwdFileInfo.justCreated || corruptedMetadata) {
				// Crea y escribe los metadatos
				metadata = {
					url: opts.url,
					initialSize: initData.fileSize,
					lastByte: 0,
					blockSize: opts.blockSize,
				};

				// NOTE: La primera vez puede demorar mucho si el archivo es demasiado grande
				await updateMetadata(fd, metadata);
				emitter.emit('metadata_created', { corruptedMetadata, ...copy(metadata) });

			}

			emitter.emit('download_begin', {
				fileSize: metadata.initialSize,
				lastByte: metadata.lastByte,
			});

			/* eslint-disable-next-line no-constant-condition */
			while (true) {
				let newDataBuffer;
				try {
					newDataBuffer = await fetchBlock(metadata);
				} catch (e) {
					// TODO timeout and re-try?
					emitter.emit('error_request', e);
					throw e;
				}

				let written = await FSUtils.write(fd, newDataBuffer, metadata.lastByte);

				metadata.lastByte += written;
				metadata.done = metadata.lastByte >= metadata.initialSize;

				await updateMetadata(fd, metadata);

				emitter.emit('progress', {
					progress: metadata.lastByte,
					total: metadata.initialSize,
					percent: Math.floor(metadata.lastByte * 100 / metadata.initialSize),
				});

				if (metadata.done) {
					emitter.emit('download_end', {});
					break;
				}
			}

			// Remover los metadatos
			await FSUtils.truncate(fd, metadata.initialSize);
			emitter.emit('truncated', {});

			await FSUtils.close(fd);

			try {
				let newName = await restoreFileName(opts.file);

				if (newName != opts.file) {
					emitter.emit('rename', { newName, oldName: opts.file });
				}
			} catch (e) {
				emitter.emit('error_rename', new Error('Error while renaming the file'));
			}

			emitter.emit('done', {});
		} catch (e) {
			emitter.emit('error', e);

			if (fd !== null) {
				await FSUtils.close(fd);
			}
		}
	};
}


/** Crea una copia de un objeto */
function copy(obj) {
	return JSON.parse(JSON.stringify(obj));
}

/** Realiza una petición para obtener los datos iniciales del archivo */
async function initialFetch(url) {
	return new Promise((resolve, reject) => {
		Request.head(url, {
			qs: { _: new Date().getTime() }, // Prevent cache
			headers: {
				Range: 'bytes=0-1',
			},
		}, (err, response, _body) => {
			try {
				if (err) {
					return reject(err);
				}

				if (response.statusCode < 200 || response.statusCode >= 300) {
					let err = new Error(`Status code: ${response.statusCode} - ${response.statusMessage}`);
					err.name = 'HttpError';
					err.statusCode = response.statusCode;
					err.statusMessage = response.statusMessage;

					return reject(err);
				}

				let fileSize = null, headers = response.headers || {};

				let serverAcceptRange = headers['accept-ranges'] === 'bytes';

				let [, range] = /bytes \d+-\d+\/(\d+)/.exec(headers['content-range']) || [];
				if (typeof range == 'string') {
					fileSize = parseInt(range);
				} else {
					fileSize = parseInt(headers['content-length']);
				}

				resolve({ fileSize, serverAcceptRange });
			} catch (e) {
				reject(e);
			}
		});
	});
}

/**
 * Obtener un bloque del archivo desde el servidor http
 *
 * @param { Object } metadata
 * @param { string } metadata.url URL del archivo
 * @param { number } metadata.lastByte Posición del último byte guardado
 * @param { number } metadata.blockSize Tamaño del bloque de bytes que se consultan
 * @returns { Promise<Buffer> }
 */
async function fetchBlock(metadata) {
	return new Promise((res, rej) => {
		Request.get(metadata.url, {
			qs: { _: new Date().getTime() }, // Prevent cache
			headers: {
				Range: `bytes=${ metadata.lastByte }-${ metadata.lastByte + metadata.blockSize - 1 }`,
			},
			encoding: null, // For Binary data
		}, (err, response, body) => err ? rej(err) : res(body));
	});
}

/**
 * Crea el archivo MWD
 *
 * @param { string } filepath
 * @returns { Promise<{ fd:number, alreadyExists:boolean, justCreated:boolean }> } fd: File descriptor
 */
async function createMWDFile(filepath) {
	let alreadyExists = true;

	if (!(await FSUtils.exists(filepath))) {
		alreadyExists = false;
		let _fd = await FSUtils.open(filepath, 'w+');
		await FSUtils.close(_fd);
	}

	return {
		alreadyExists,
		justCreated: !alreadyExists,
		fd: await FSUtils.open(filepath, 'r+'),
	};
}

/**
 * Actualizar los metadatos
 *
 * @param { number } fd File descriptor
 * @param { Object } metadata
 * @param { number } metadata.initialSize Para saber la posición donde comienzan los metadatos
 */
async function updateMetadata(fd, metadata) {
	let buffer = Buffer.alloc(1024); // 1Kb for metadata
	buffer.write(JSON.stringify(metadata));

	await FSUtils.write(fd, buffer, metadata.initialSize);
}

/**
 * Leer los metadatos desde el archivo
 *
 * @param { string } filepath
 * @param { Object? } metadata
 * @param { number } metadata.initialSize Para saber la posición donde comienzan los metadatos
 */
async function readMetadata(filepath, metadata) {
	let result, start;
	if (metadata) {
		start = metadata.initialSize;
	} else {
		// Leer el último Kb
		let _stats = await FSUtils.stat(filepath);
		start = _stats.size - 1024;
	}

	// TODO usar opción 'fd'? Ignora filepath
	let reader = fs.createReadStream(filepath, { start });

	return new Promise((res, rej) => {
		let rejected = false;

		reader.on('data', metadataBuffer => {
			try {
				// let metadataBuffer = buffer.slice(start);
				let until = metadataBuffer.indexOf(0);

				result = JSON.parse(metadataBuffer.slice(0, until).toString());
			} catch (e) {
				rejected = true;
				rej(e);
			}
		});

		reader.on('close', () => {
			if (!rejected) {
				res(result);
			}
		});

		reader.read();
	});
}

async function restoreFileName(filepath) {
	// TODO si newName ya existe?

	if (/\.mwd$/i.test(filepath)) {
		let newName = filepath.substring(0, filepath.length - 4);

		if (await FSUtils.exists(newName)) {
			throw new Error('File already exists');
		}

		await FSUtils.rename(filepath, newName);
		return newName;
	}

	return filepath;
}
