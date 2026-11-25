import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveWindowsCommand(file: string, args: string[], env: NodeJS.ProcessEnv): { file: string; args: string[] | string } {
  const extensions = path.extname(file) ? [''] : (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';');
  const directories = path.isAbsolute(file) || /[\\/]/.test(file) ? [''] : (env.PATH || env.Path || '').split(';');
  let resolved: string | undefined;
  for (const directory of directories) {
    for (const extension of extensions) {
      const name = `${file}${extension.toLowerCase()}`;
      const candidate = directory ? path.join(directory, name) : name;
      if (existsSync(candidate)) { resolved = candidate; break; }
    }
    if (resolved) break;
  }
  if (!resolved) throw new Error(`找不到智能体命令：${file}。请确认已安装并加入 PATH，然后重启工作台。`);
  if (!/\.(cmd|bat)$/i.test(resolved)) return { file: resolved, args };
  if ([resolved, ...args].some((value) => /["%\r\n!&|<>^]/.test(value))) {
    throw new Error('命令或参数包含不受支持的批处理特殊字符');
  }
  return { file: env.ComSpec || env.COMSPEC || 'cmd.exe', args: `/d /s /c ""${resolved}" ${args.map((arg) => `"${arg}"`).join(' ')}"` };
}
