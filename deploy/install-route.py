"""Add only Part Viewer's route to the shared Caddy configuration, with rollback."""
from pathlib import Path
from datetime import datetime, timezone
import shutil
import subprocess

target = Path('/opt/apps/proxy/Caddyfile')
original = target.read_text()
if '/part-viewer' in original:
    raise SystemExit('Part Viewer route already exists; inspect it rather than overwriting it.')
anchor = '\thandle {\n\t\treverse_proxy duramark-portal:80\n\t}'
if original.count(anchor) != 1:
    raise SystemExit('Expected portal fallback not found exactly once; no changes made.')
route = '''\tredir /part-viewer /part-viewer/

\thandle_path /part-viewer/* {
\t\treverse_proxy duramark-part-viewer:3000
\t}

'''
candidate = target.with_name('Caddyfile.part-viewer.candidate')
candidate.write_text(original.replace(anchor, route + anchor))
subprocess.run(['docker', 'cp', str(candidate), 'apps-caddy:/tmp/part-viewer.Caddyfile'], check=True)
subprocess.run(['docker', 'exec', 'apps-caddy', 'caddy', 'validate', '--config', '/tmp/part-viewer.Caddyfile', '--adapter', 'caddyfile'], check=True)
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = target.with_name('Caddyfile.before-part-viewer.' + stamp)
shutil.copy2(target, backup)
try:
    # Write in place: replacing the inode would leave Caddy's existing bind mount stale.
    target.write_text(candidate.read_text())
    subprocess.run(['docker', 'exec', 'apps-caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
    subprocess.run(['docker', 'exec', 'apps-caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
except Exception:
    target.write_text(original)
    subprocess.run(['docker', 'exec', 'apps-caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
    raise
print('Part Viewer route installed. Previous configuration:', backup)
