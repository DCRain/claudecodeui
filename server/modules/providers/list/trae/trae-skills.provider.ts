import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
} from '@/shared/utils.js';

const TRAE_PROJECT_SKILL_DIRS = [
  ['.trae', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

const TRAE_USER_SKILL_DIRS = [
  ['.trae', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
];

export class TraeSkillsProvider extends SkillsProvider {
  constructor() {
    super('trae');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const repoRoot = await findTopmostGitRoot(workspacePath);

    for (const projectRoot of this.getProjectSearchRoots(workspacePath, repoRoot)) {
      for (const skillDir of TRAE_PROJECT_SKILL_DIRS) {
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'project',
          rootDir: path.join(projectRoot, ...skillDir),
          commandPrefix: '/',
        });
      }
    }

    for (const skillDir of TRAE_USER_SKILL_DIRS) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir: path.join(os.homedir(), ...skillDir),
        commandPrefix: '/',
      });
    }

    return sources;
  }

  private getProjectSearchRoots(workspacePath: string, repoRoot: string | null): string[] {
    const roots: string[] = [];
    const normalizedWorkspacePath = path.resolve(workspacePath);
    const normalizedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
    let currentPath = normalizedWorkspacePath;
    while (true) {
      roots.push(currentPath);
      if (!normalizedRepoRoot || currentPath === normalizedRepoRoot) break;
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) break;
      currentPath = parentPath;
    }
    return roots;
  }
}
