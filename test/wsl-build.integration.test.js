import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

test('actual WSL shell builds isolated Chinese/space/metacharacter filename, preserves arguments and rejects output symlinks',{timeout:60000},async t=>{
  if(process.platform!=='win32'){t.skip('This integration check targets the Windows Remote-WSL deployment.');return;}
  const available=spawnSync('wsl.exe',['--exec','/bin/sh','-c','command -v g++ >/dev/null'],{windowsHide:true,encoding:'utf8',timeout:20000});
  if(available.error||available.status!==0){t.skip('WSL/g++ is unavailable: '+(available.error?.message||available.stderr||'not found'));return;}
  const script=(await fs.readFile(new URL('../vscode-extension/wsl-build.sh',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  const fixture=String.raw`
set -eu
root=$(mktemp -d /tmp/grid-wsl-audit.XXXXXX)
cleanup() { case "$root" in /tmp/grid-wsl-audit.*) rm -rf -- "$root" ;; *) exit 99 ;; esac; }
trap cleanup EXIT HUP INT TERM
cd "$root"
printf '%s' '__SCRIPT__' | base64 -d > "$root/grid-build.sh"
mkdir -p "$root/课程 空格"
src="$root/课程 空格/题目 '; \$(touch PWNED)%.cpp"
printf '#include <iostream>\nint main(){std::cout << VALUE;return 0;}\n' > "$src"
/bin/sh "$root/grid-build.sh" "$src" g++ -std=c++17 '-DUNUSED=hello world' -DVALUE=42
output_directory=@{src%/*}/build
filename=@{src##*/}
binary=$output_directory/@{filename%.cpp}
test "$("$binary")" = 42
test ! -e "$binary.exe"
test ! -e "$root/PWNED"
test -f "$output_directory/.gitignore"
if /bin/sh "$root/grid-build.sh" "$src" g++ -o "$root/not-allowed"; then exit 10; fi
test ! -e "$root/not-allowed"
rm -- "$binary"
printf 'untouched' > "$root/target"
ln -s "$root/target" "$binary"
if /bin/sh "$root/grid-build.sh" "$src" g++; then exit 11; fi
test "$(cat "$root/target")" = untouched
printf 'WSL_BUILD_OK\n'
`.replaceAll('@{','${').replace('__SCRIPT__',Buffer.from(script).toString('base64'));
  const result=spawnSync('wsl.exe',['--exec','/bin/sh','-s'],{input:fixture,encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:1000000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/WSL_BUILD_OK/);
});
