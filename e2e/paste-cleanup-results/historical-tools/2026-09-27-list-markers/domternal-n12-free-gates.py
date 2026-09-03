import subprocess,os,json,time
from pathlib import Path
root=Path('$HOME/Documents/Domternal/domternal')
prefix=Path('/private/tmp/domternal-n12-free-gates')
env={**os.environ,'PATH':'$HOME/.nvm/versions/node/v22.23.2/bin:'+os.environ['PATH'],'NX_DAEMON':'false','NX_ISOLATE_PLUGINS':'false'}
gates=['test:types-consumer','test:api-surface','test:ssr-import','test:bundle-size','test:package-artifacts','test:externals','test:single-prosemirror','test:i18n','test:third-party-notices','test:ci-wiring','test:hidden-attribute','test:css-vars','test:theme-tokens','test:dedupe-reachable:unit','test:pm-ranges:unit']
results=[]
for gate in gates:
 path=Path(str(prefix)+'-'+gate.replace(':','-')+'.log')
 start=time.monotonic()
 with path.open('w') as log:
  code=subprocess.run(['pnpm',gate],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT).returncode
 row={'gate':gate,'exitCode':code,'elapsedSeconds':round(time.monotonic()-start,3),'log':str(path)}
 results.append(row);print(json.dumps(row),flush=True)
 Path(str(prefix)+'.json').write_text(json.dumps(results,indent=2)+'\n')
Path(str(prefix)+'.done').write_text(str(int(any(row['exitCode'] for row in results)))+'\n')
raise SystemExit(any(row['exitCode'] for row in results))
