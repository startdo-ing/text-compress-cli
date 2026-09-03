/**
 * @module cli/usage
 *
 * Help text for the `text-compress` CLI.
 */

/** Print usage guide to stdout. */
export function printUsage() {
  console.log(`
text-compress - brotli (max quality) compress/decompress with base64 or base85 output

Usage:
  text-compress [path|options]
  npx text-compress <path> [options]

Auto-detect:
  Pass a file or folder path with no subcommand. Plain files and folders are
  compressed; valid compressed payloads are decompressed automatically.
  Folders are always compressed.

Options:
  <path>                  Input path (auto-detects file vs folder)
  -t, --text <string>     Input given directly as a string
  -f, --file <path>       Input file (optional; same as passing <path>)
  -d, --dir <path>        Input folder (optional; same as passing <path>)
  -C, --compress          Always compress (even if input looks compressed)
  -D, --decompress        Always decompress
  --send                  Stream the payload as looping QR codes (camera receive)
  send <path>             Same as --send (optional subcommand)
  -o, --output <path>     Output path (optional, see defaults below)
  -s, --split <chars>     Split compressed output into multiple files. Each
                           part file is at most this many characters total,
                           including the ;TCP2; header (compress only).
                           Use 0 to write a single file (no split).
                           If omitted, auto-splits at 30,000 characters when
                           the output is larger. Parts are named by inserting
                           .NNN before the extension, e.g. output.001.txt
  --no-split              Same as -s 0: never split compressed output
  -e, --encoding <64|85>  Text encoding for the compressed output (default: 64)
                             64: standard base64 [A-Za-z0-9+/=] — safe to
                                 paste literally anywhere (chat, email, etc.)
                             85: Z85 base85 — ~8% smaller, but uses extra
                                 punctuation; only paste it somewhere that
                                 preserves text verbatim (e.g. a code block)
  -p, --password <string>  Password-protect on compress, or unlock on decompress
  --fps <1-24>             QR send frame rate (default: 8)
	--chunk-size <chars>     QR send payload chars per frame (default: fits 2×2 terminal grid)
  --ec <L|M|Q|H>           QR error correction (default: M)
  --raw                    QR send the file as-is, without compressing
  --dump                   Print one lap of QR frame text instead of animating
  -h, --help               Show this usage guide
  -V, --version            Show package version

Split output (decompress):
  Pass any one sibling file. All files sharing the same basename prefix
  (segment before the first ".") are scanned; invalid siblings are skipped.
  Part order comes from embedded headers, not filenames.

Defaults:
  If -o is omitted, the output path is derived from the input's name:
    compress (file/text): <input>.txt
    compress (folder):    <folder-name>.txt
    decompress (text):    <input>.de.txt
    decompress (folder):  <input>.de   (recreated as a directory)

Examples:
  text-compress notes.md
  text-compress notes.md -p "my secret"
  text-compress ./my-project
  text-compress notes.md -e 85
  text-compress notes.md -s 4000
  text-compress notes.md --no-split
  text-compress output.txt
  text-compress output.txt -p "my secret"
  text-compress output.01.txt
  text-compress -t "some text" -o output.txt
  text-compress --compress notes.txt
  text-compress send notes.md
  text-compress notes.md --send --fps 10
  npx text-compress ./somefile.md -p "hello-world"

Every run prints analytics (encoding, size, ratio, time taken) after
writing the output.

v1 CLI (@startdoing/tc) remains on npm at 1.0.4. v2 is published as text-compress.
`)
}
