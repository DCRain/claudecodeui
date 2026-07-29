import { TraeProviderAuth } from '@/modules/providers/list/trae/trae-auth.provider.js';
import { TraeProviderModels } from '@/modules/providers/list/trae/trae-models.provider.js';
import { TraeMcpProvider } from '@/modules/providers/list/trae/trae-mcp.provider.js';
import { TraeSessionSynchronizer } from '@/modules/providers/list/trae/trae-session-synchronizer.provider.js';
import { TraeSessionsProvider } from '@/modules/providers/list/trae/trae-sessions.provider.js';
import { TraeSkillsProvider } from '@/modules/providers/list/trae/trae-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

export class TraeProvider extends AbstractProvider {
  readonly models: IProviderModels = new TraeProviderModels();
  readonly mcp = new TraeMcpProvider();
  readonly auth: IProviderAuth = new TraeProviderAuth();
  readonly skills: IProviderSkills = new TraeSkillsProvider();
  readonly sessions: IProviderSessions = new TraeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new TraeSessionSynchronizer();

  constructor() {
    super('trae');
  }
}
