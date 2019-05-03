# MW-Downloader

Command-line utility for resumable downloads

## Install

```bash
$ npm install -g mw-downloader
```

### Help

```bash
$ mwd --help
$ mwd url --help
```

## Usage

```bash
$ mwd url [options] <url>
```

Basic example:

```bash
$ mwd url http://remote-server/example.zip
```

This command creates an "*example.zip.mwd*" file in the current directory.

When the download is finished, this file is renamed.

## Options

|Option|Description|Default value|
|------|-----------|-------------|
| --filename &lt;*filename*&gt; | Sets the name for the downloaded file | *&lt;URL file name&gt;* |
| --block-size &lt;*size*&gt; | Size of each chunk of data to be downloaded. Examples: `512` (512 bytes), `4KB` (`4096` bytes, same as `4k`, `4K`, `4kB`, `4096b`, etc.), `2Mb`, `1G` | `4Mb` |
| --replace | Overwrites the file if it already exists | `false` |
| --no-progress | No progress bar | `false` *(progress bar is visible)* |

Example with options:

```bash
$ mwd url --filename custom_name.zip --replace --no-progress http://remote-server/large_file.zip
```
