import type { Project } from '../../types/app';

/** Synthetic project so plain shells default cwd to the user home (`~`). */
export const HOME_TERMINAL_PROJECT: Project = {
  projectId: 'home-terminal',
  displayName: 'Home',
  fullPath: '~',
  path: '~',
};
