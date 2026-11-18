#!/usr/bin/env bash
set -Eeuo pipefail
exec timeout --signal=TERM --kill-after=15s 540 bash -s <<'BUILD'
set -Eeuo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8
w=/var/tmp/superserve-coreutils-build
u=ss-coreutils-build
manifest=/usr/local/share/superserve-coreutils-build.json
stage=initialization
note() { stage=$1; printf 'NATIVE_BUILD %s\n' "$stage"; }
trap 'rc=$? line=$LINENO command=$BASH_COMMAND; printf "NATIVE_BUILD_FAILED stage=%s rc=%s line=%s command=%s\n" "$stage" "$rc" "$line" "$command" >&2; for log in "$w/build.log" "$w/apt.log" "$w/runtime-ldd.txt" "$w/abc-sha256.txt"; do if [[ -f $log ]]; then printf "DIAGNOSTIC %s\n" "$log" >&2; tail -n 35 "$log" >&2; fi; done; exit "$rc"' ERR
[[ $(id -u) = 0 ]]
[[ $(dpkg --print-architecture) = amd64 ]]
jobs=$(nproc); if ((jobs>8)); then jobs=8; fi
. /etc/os-release
[[ ${ID:-} = debian && ${VERSION_CODENAME:-} = bookworm ]]
[[ ! -e $w && ! -e $manifest ]]
! id "$u" >/dev/null 2>&1 || false
mkdir -p "$w/source" /usr/local/share
installed() { dpkg-query -W -f='${binary:Package} ${db:Status-Status}\n' | awk '$2=="installed" {print $1}' | sort -u; }
installed > "$w/initial-installed"
apt-mark showmanual | sort -u > "$w/initial-manual"
dpkg-query -W -f='${binary:Package}\t${Version}\t${db:Status-Status}\n' > "$w/initial-versions"
note authenticated-bookworm-source
node - <<'JS'
const fs=require('fs'), d='/etc/apt/sources.list.d/', blocks=[], lines=[];
for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.sources'))) for(const b of fs.readFileSync(d+f,'utf8').split(/\n\s*\n/)) {
 const fields=Object.fromEntries([...b.matchAll(/^([A-Za-z-]+):\s*(.*)$/gm)].map(m=>[m[1].toLowerCase(),m[2].trim()]));
 if(fields.enabled==='no'||!fields.types?.split(/\s+/).includes('deb')||!fields.suites?.split(/\s+/).some(s=>s.startsWith('bookworm')))continue;
 if(fields.trusted==='yes')throw Error('Unsigned source refused');
 blocks.push(b.replace(/^Types:.*$/m,'Types: deb-src'));
}
for(const p of ['/etc/apt/sources.list',...fs.readdirSync(d).filter(x=>x.endsWith('.list')).map(x=>d+x)]) if(fs.existsSync(p)) for(const l of fs.readFileSync(p,'utf8').split('\n')) if(/^\s*deb\s+/.test(l)&&/\bbookworm(?:-[a-z]+)?\b/.test(l)) {
 if(/trusted\s*=\s*yes/i.test(l))throw Error('Unsigned source refused');lines.push(l.replace(/^(\s*)deb\s+/,'$1deb-src '));
}
if(!blocks.length&&!lines.length)throw Error('No Bookworm source configuration');
if(blocks.length)fs.writeFileSync(d+'superserve-coreutils-build.sources',blocks.join('\n\n')+'\n');
if(lines.length)fs.writeFileSync(d+'superserve-coreutils-build.list',lines.join('\n')+'\n');
JS
apt=(apt-get -o Acquire::AllowInsecureRepositories=false -o APT::Get::AllowUnauthenticated=false)
"${apt[@]}" update > "$w/apt.log" 2>&1
"${apt[@]}" install -y --no-install-recommends build-essential dpkg-dev fakeroot libssl-dev >> "$w/apt.log" 2>&1
"${apt[@]}" build-dep -y --no-install-recommends coreutils=9.1-1 >> "$w/apt.log" 2>&1
(cd "$w/source"; "${apt[@]}" source --only-source coreutils=9.1-1) >> "$w/apt.log" 2>&1
src=$w/source/coreutils-9.1
[[ $(cd "$src"; dpkg-parsechangelog -S Version) = 9.1-1 ]]
cp "$src/debian/changelog" "$w/distro-changelog"
cat > "$src/debian/changelog" <<'CHANGELOG'
coreutils (9.1-1+0superserve.openssl1) bookworm; urgency=medium

  * Enable OpenSSL-backed GNU digest routines for general sandbox workloads.

 -- Superserve Local Build <builder@localhost>  Sat, 14 Nov 2026 00:27:56 +0000

CHANGELOG
cat "$w/distro-changelog" >> "$src/debian/changelog"
[[ $(grep -c '^[[:space:]]*dh_auto_configure' "$src/debian/rules") = 1 ]]
! grep -q -- '--with-openssl' "$src/debian/rules" || false
sed -i '/^[[:space:]]*dh_auto_configure/ s/$/ --with-openssl=yes/' "$src/debian/rules"
dpkg --compare-versions 9.1-1+0superserve.openssl1 gt 9.1-1
dpkg --compare-versions 9.1-1+0superserve.openssl1 lt 9.1-1+deb12u1
[[ $(cd "$src"; dpkg-parsechangelog -S Timestamp) = 1794616076 ]]
note unprivileged-debian-package-build
useradd --create-home --shell /bin/bash "$u"
chown -R "$u:$u" "$w/source"
(cd "$src"; runuser -u "$u" -- env -i PATH="$PATH" HOME="/home/$u" USER="$u" LOGNAME="$u" SHELL=/bin/bash LC_ALL=C.UTF-8 SOURCE_DATE_EPOCH=1794616076 DEB_BUILD_OPTIONS="nocheck parallel=$jobs" dpkg-buildpackage -b -uc -us -j"$jobs") > "$w/build.log" 2>&1
[[ -f $src/lib/config.h ]]
grep -q '^#define HAVE_OPENSSL_SHA256 1$' "$src/lib/config.h"
deb=$w/source/coreutils_9.1-1+0superserve.openssl1_amd64.deb
[[ -f $deb && $(dpkg-deb -f "$deb" Version) = 9.1-1+0superserve.openssl1 ]]
note install-and-verify-runtime
"${apt[@]}" install -y --no-install-recommends "$deb" >> "$w/apt.log" 2>&1
ldd /usr/bin/sha256sum > "$w/runtime-ldd.txt" 2>&1
grep 'libcrypto.so.3' "$w/runtime-ldd.txt"
crypto=$(awk '$1=="libcrypto.so.3" && $2=="=>" {print $3}' "$w/runtime-ldd.txt")
printf 'RUNTIME_LIBCRYPTO path=%s\n' "$crypto"
[[ -n $crypto && -f $crypto ]]
readlink -f "$crypto"
actual=$(sha256sum /usr/bin/sha256sum); actual=${actual%% *}; expected=e73e6391cac3105cdfcedd9563c6e4f0ea5f41e2c1e4b57ea9f1c7a9188765a6
printf 'RUNTIME_HASH sha256sum actual=%s expected=%s\n' "$actual" "$expected"
[[ $actual = "$expected" ]]
actual=$(sha256sum /bin/dd); actual=${actual%% *}; expected=ae3806993a83b17ab14d7922b1e57846f8be43e4afb9ab2c3da9f850f64bfa1c
printf 'RUNTIME_HASH dd actual=%s expected=%s\n' "$actual" "$expected"
[[ $actual = "$expected" ]]
printf abc > "$w/abc"
sha256sum "$w/abc" > "$w/abc-sha256.txt"
read -r actual ignored < "$w/abc-sha256.txt"; expected=ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
printf 'RUNTIME_HASH abc actual=%s expected=%s\n' "$actual" "$expected"
[[ $actual = "$expected" ]]
sha256sum "$deb" > "$w/package-sha256"
note remove-build-only-dependencies
installed > "$w/built-installed"
comm -13 "$w/initial-installed" "$w/built-installed" > "$w/new-installed"
xargs -r apt-mark auto < "$w/new-installed" >> "$w/apt.log" 2>&1
xargs -r apt-mark manual < "$w/initial-installed" >> "$w/apt.log" 2>&1
"${apt[@]}" -o APT::AutoRemove::RecommendsImportant=false --simulate autoremove --purge > "$w/autoremove-simulation.log" 2>&1
awk '$1=="Remv" || $1=="Purg" {print $2}' "$w/autoremove-simulation.log" | while read -r pkg; do dpkg-query -W -f='${binary:Package}\n' "$pkg"; done | sort -u > "$w/planned-removals"
comm -12 "$w/initial-installed" "$w/planned-removals" > "$w/planned-baseline-removals"
[[ ! -s $w/planned-baseline-removals ]]
! grep -Eq '^libssl3(:amd64)?$' "$w/planned-removals" || false
"${apt[@]}" -o APT::AutoRemove::RecommendsImportant=false autoremove -y --purge >> "$w/apt.log" 2>&1
installed > "$w/final-installed"
comm -23 "$w/initial-installed" "$w/final-installed" > "$w/missing-baseline"
[[ ! -s $w/missing-baseline ]]
comm -23 "$w/initial-installed" "$w/initial-manual" | xargs -r apt-mark auto >> "$w/apt.log" 2>&1
xargs -r apt-mark manual < "$w/initial-manual" >> "$w/apt.log" 2>&1
apt-mark showmanual | sort -u > "$w/final-manual"
cmp "$w/initial-manual" "$w/final-manual"
comm -13 "$w/initial-installed" "$w/final-installed" > "$w/remaining-new"
grep -Ev '^libssl3(:amd64)?$' "$w/remaining-new" > "$w/unexpected-new" || true
[[ ! -s $w/unexpected-new ]]
node - "$w" "$manifest" "$jobs" <<'JS'
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),path=require('path'),[w,out,jobs]=process.argv.slice(2);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const lines=p=>fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean);
const files=cp.execFileSync('dpkg-query',['-L','coreutils'],{encoding:'utf8'}).trim().split('\n'),binaries={};
for(const p of files)if(fs.existsSync(p)){const s=fs.statSync(p);if(s.isFile()&&(s.mode&0o111))binaries[p]={sha256:hash(p),bytes:s.size};}
const sourceFiles={};for(const n of fs.readdirSync(w+'/source'))if(/\.(dsc|tar\.(xz|gz|bz2))$/.test(n))sourceFiles[n]=hash(w+'/source/'+n);
const remaining=lines(w+'/remaining-new');const result={schema:1,package:'coreutils',sourceVersion:'9.1-1',version:'9.1-1+0superserve.openssl1',sourceDateEpoch:1794616076,configureFlag:'--with-openssl=yes',sourceFiles,packageSha256:lines(w+'/package-sha256')[0].split(/\s+/)[0],binaries,initialInstalled:lines(w+'/initial-installed'),initialManual:lines(w+'/initial-manual'),remainingNewPackages:remaining,remainingNewPackageVersions:remaining.map(p=>cp.execFileSync('dpkg-query',['-W','-f=${binary:Package}\t${Version}',p],{encoding:'utf8'})),baselinePackagesRemoved:lines(w+'/missing-baseline'),architecture:'amd64',buildJobs:Number(jobs),buildOptions:'nocheck parallel='+jobs,watchdogSeconds:540,packageBuildChecksSkipped:true,packageBuildExecutesUpstreamTests:false,cleanup:{baselinePackagesPreserved:true,manualMarksRestoredExactly:true,onlyAdditionalRuntimeLibrary:true,plannedRemovedPackages:lines(w+'/planned-removals'),autoremoveRecommendationsImportant:false},fullSuite:'Previously validated identical sha256sum/dd payloads; no full-suite rerun in image build.',cleanupComplete:false};
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
JS
tail -n 35 "$w/build.log" > /usr/local/share/superserve-coreutils-build.log
note clean-source-and-build-user
userdel --remove "$u" >/dev/null 2>&1
getent group "$u" >/dev/null && groupdel "$u" || true
rm -f /etc/apt/sources.list.d/superserve-coreutils-build.sources /etc/apt/sources.list.d/superserve-coreutils-build.list
rm -rf "$w" /var/lib/apt/lists/*
apt-get clean
node - "$manifest" <<'JS'
const fs=require('fs'),p=process.argv[2],x=JSON.parse(fs.readFileSync(p));x.cleanupComplete=!fs.existsSync('/var/tmp/superserve-coreutils-build');if(!x.cleanupComplete)throw Error('Build tree remains');fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
JS
note complete
BUILD
