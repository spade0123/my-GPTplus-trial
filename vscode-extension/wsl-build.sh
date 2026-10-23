#!/bin/sh
# Grid-Code managed WSL build v1
# Runs in WSL only when the user invokes the VS Code build task.
set -eu
source_file=$1
compiler=$2
shift 2
case "$source_file" in /*.c|/*.cc|/*.cpp|/*.cxx) ;; *) printf '%s\n' 'Expected an absolute C/C++ source path in WSL.' >&2; exit 2 ;; esac
for argument in "$@"; do
  case "$argument" in -o*) printf '%s\n' 'Output is managed by Grid: remove -o from build arguments.' >&2; exit 2 ;; esac
done
directory=${source_file%/*}/build
if [ -L "$directory" ]; then printf '%s\n' 'build must not be a symbolic link.' >&2; exit 2; fi
mkdir -p -- "$directory"
if [ ! -e "$directory/.gitignore" ] && [ ! -L "$directory/.gitignore" ]; then
  (set -C; printf '*\n!.gitignore\n' > "$directory/.gitignore") || true
fi
filename=${source_file##*/}
output=$directory/${filename%.*}
printf 'Source: %s\nOutput: %s\n' "$source_file" "$output"
exec "$compiler" "$@" "$source_file" -o "$output"
