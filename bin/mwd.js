#!/usr/bin/env node

'use strict';

const program = require('commander');
const urlUtils = require('url');
const Progress = require('progress');
const MWDownloader = require('../');
const FSUtils = require('../fs-utils');

program.version(require('../package.json').version, '-v, --version');
program.name('mwd');
program.usage('<url|file> [options]');
program.allowUnknownOption(false);

program
    .command('url <url>')
    .description('Download a file from the specified URL. If "<filename>.mwd" already exists then the download is resumed.')
    .option('--filename <filename>', 'Local file name')
    .option('--block-size <size>', 'Size of each chunk of data downloaded', parseBlockSize)
    .option('--replace', 'Overwrites the file if it already exists')
    .option('--no-progress', 'No progress bar')
    .action(runUrlCommand);

program
    .command('file <file>')
    .description('Resume download from an already existing .mwd file')
    .option('--block-size <size>', 'Size of each chunk of data downloaded', parseBlockSize)
    .option('--no-progress', 'No progress bar')
    .action(runFileCommand);

program.parse(process.argv);

/**
 * Parse block size to number of bytes.
 * Units (case insensitive): B, K/KB, M/MB, G/GB, T/TB
 * 
 * @param { string } value 
 * @return { number } Number of bytes
 * 
 * @example
 * parseBlockSize('5') == 5 == parseBlockSize('5b')
 * parseBlockSize('4k') == 4096 == (4 * 1024)
 * parseBlockSize('5Mb') == 5242880 == (5 * 1024 * 1024)
 * parseBlockSize('2gB') == 2147483648‬ == (2 * 1024 * 1024 * 1024)
 * parseBlockSize('1T') == 1099511627776 == (1 * 1024 * 1024 * 1024 * 1024)
 */
function parseBlockSize(value) {
    let validRegex = /^\s*(\d+[kmgt]?b?)\s*$/i;
    if (!validRegex.test(value)) {
        throw new Error('Invalid block size');
    }

    let [, size, type] = /^\s*(\d+)([kmgt]?b?)\s*$/i.exec(value) || [];
    if (!size) {
        throw new Error('Invalid block size');
    }

    size = parseInt(size);
    type = type.toUpperCase()[0] || 'B';

    let result = size;
    switch (type) {
        case 'K': return size * 1024;
        case 'M': return size * 1024 * 1024;
        case 'G': return size * 1024 * 1024 * 1024;
        case 'T': return size * 1024 * 1024 * 1024 * 1024;
    }

    return Math.max(1, parseInt(result));
}


async function runUrlCommand(url, { filename, blockSize, replace, progress }) {
    let file = filename, progressBar;
    
    let terminateProgressBar = () => {
        progressBar && progressBar.terminate();
    };

    if (!filename) {
        let urlObj = urlUtils.parse(url);
        let index = urlObj.pathname.lastIndexOf('/');
        
        if (index < 0 || (index + 1) == urlObj.pathname.length) {
            throw new Error('Must indicate a file name');
        }

        file = urlObj.pathname.substr(index + 1);
        console.info('File name: ' + file);
    }

    let fileExists = await FSUtils.exists(file);
    if (fileExists) {
        if (replace) {
            await FSUtils.unlink(file);
        } else {
            throw new Error('File already exists');
        }
    }

    let download = new MWDownloader({
        file,
        blockSize,
        url
    });

    download.on('file_created', ({ size }) => {
        console.info('Configuring file...');
        if (size >= 300 * 1024 * 1024) { // (size >= 300Kb)
            console.info('(Can take a while for large files)');
        }
    });

    download.on('download_begin', ({ fileSize, lastByte }) => {
        console.info('Downloading file...');

        if (progress) {
            let curr = Math.floor(lastByte * 100 / fileSize);

            progressBar = new Progress(':percent :bar', {
                total: 100,
                curr,
                complete: '#',
                incomplete: ' ',
                renderThrottle: 200,
                clear: true
            });
        }
    });

    if (progress) {
        download.on('progress', ({ percent }) => {
            progressBar && progressBar.update(percent / 100);
        });
    }

    download.on('download_end', () => {
        terminateProgressBar();
    });

    download.on('done', () => {
        terminateProgressBar();
        console.info('Done');
        
        download.dispose();
    });

    download.on('error', e => {
        terminateProgressBar();
        console.error('Error downloading the file');
        console.error(e && (e.stack || e.message) || e);
    });

    download.start();
}


async function runFileCommand(file, opts) {
    // TODO implement
    console.warn('TODO: Not implemented. Use `mwd url <url>` instead.');
}
