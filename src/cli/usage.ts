/**
 * @module cli/usage
 *
 * Help text for the `tc` CLI.
 */

/** Print usage guide to stdout. */
export function printUsage() {
	console.log(`
tc - brotli (max quality) compress/decompress with base64 or base85 output

Usage:
  tc <command> [options]

Commands:
  compress      Brotli-compress the input (max quality), encode it, and
                write it to a file. Pass a path to auto-detect file vs
                folder, or use -t for inline text. Folder compression
                automatically applies .gitignore rules (outside → inside).
  decompress    Decode the input, brotli-decompress it, and write the
                result. Pass a path to the compressed file; auto-detects
                split parts (e.g. output.01.txt) and whether the payload
                was text or a packed folder. Must use the same -e/--encoding
                as the compress step.

Options:
  <path>                  Input path (auto-detects file vs folder on compress)
  -t, --text <string>     Input given directly as a string
  -f, --file <path>       Input file (optional; same as passing <path>)
  -d, --dir <path>        Input folder (optional; same as passing <path>)
  -o, --output <path>     Output path (optional, see defaults below)
  -s, --split <chars>     Split compressed output into multiple files, each
                           at most this many characters (compress only).
                           If omitted, auto-splits at 30,000 characters when
                           the output is larger. Parts are named by inserting
                           .NNN before the extension, e.g. output.001.txt
  -e, --encoding <64|85>  Text encoding for the compressed output (default: 64)
                             64: standard base64 [A-Za-z0-9+/=] — safe to
                                 paste literally anywhere (chat, email, etc.)
                             85: Z85 base85 — ~8% smaller, but uses extra
                                 punctuation; only paste it somewhere that
                                 preserves text verbatim (e.g. a code block)
  -h, --help               Show this usage guide

Defaults:
  If -o is omitted, the output path is derived from the input's name:
    compress (file/text): <input>.txt
    compress (folder):    <folder-name>.txt
    decompress (text):    <input>.de.txt
    decompress (folder):  <input>.de   (recreated as a directory)

Examples:
  tc compress -t "some text" -o output.txt
  tc compress notes.md
  tc compress notes.md -e 85
  tc compress ./my-project
  tc compress notes.md -s 4000
  tc decompress notes.txt
  tc decompress output.01.txt
  tc decompress my-project.txt
  tc decompress -t "<base64>" -o restored.txt

Every run prints analytics (encoding, size, ratio, time taken) after
writing the output.
`);
}
