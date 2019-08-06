const fs = require('fs');

const exists = filepath => new Promise((res, rej) => {
	fs.stat(filepath, (err, _stat) => {
		if (!err) {
			return res(true);
		}

		if (err.code == 'ENOENT') {
			return res(false);
		}

		rej(err);
	});
});

const open = (filepath, flags) => new Promise((res, rej) => {
	fs.open(filepath, flags, (err, fd) => err ? rej(err) : res(fd));
});

const close = fd => new Promise((res, rej) => {
	fs.close(fd, err => err ? rej(err) : res());
});

const write = (fd, buffer, position) => new Promise((res, rej) => {
	fs.write(fd, buffer, 0, buffer.length, position, (err, written) => err ? rej(err) : res(written));
});

const truncate = (fd, length) => new Promise((res, rej) => {
	fs.ftruncate(fd, length, err => err ? rej(err) : res());
});

const rename = (oldPath, newPath) => new Promise((res, rej) => {
	fs.rename(oldPath, newPath, err => err ? rej(err) : res());
});

const stat = filepath => new Promise((res, rej) => {
	fs.stat(filepath, (err, stats) => err ? rej(err) : res(stats));
});

const unlink = filepath => new Promise((res, rej) => {
	fs.unlink(filepath, err => err ? rej(err) : res());
});


const FSUtils = {
	exists,
	open,
	close,
	write,
	truncate,
	rename,
	stat,
	unlink,
};

module.exports = FSUtils;
