import express from 'express';
import { spawn } from 'cross-spawn';

import { getConnection } from '@/modules/database/connection.js';
import { AppError } from '@/shared/utils.js';

type CustomCommand = {
  id: number;
  project_id: string;
  name: string;
  command: string;
  sort_order: number;
  created_at: string;
};

function readBody(request: express.Request): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null
    ? (request.body as Record<string, unknown>)
    : {};
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${fieldName} is required`, {
      code: 'INVALID_CUSTOM_COMMAND',
      statusCode: 400,
    });
  }
  return value.trim();
}

function readOptionalNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  return 0;
}

export function createCustomCommandsRouter(): express.Router {
  const router = express.Router();

  function getDb() {
    return getConnection();
  }

  // List custom commands for a project
  router.get('/', (request, response) => {
    const projectId = readRequiredString(request.query.project, 'project');
    const db = getDb();
    const commands = db
      .prepare(
        'SELECT * FROM custom_commands WHERE project_id = ? ORDER BY sort_order ASC, id ASC'
      )
      .all(projectId) as CustomCommand[];
    response.json({ success: true, data: commands });
  });

  // Create a custom command
  router.post('/', (request, response) => {
    const body = readBody(request);
    const projectId = readRequiredString(body.projectId, 'projectId');
    const name = readRequiredString(body.name, 'name');
    const command = readRequiredString(body.command, 'command');
    const sortOrder = readOptionalNumber(body.sortOrder);

    const db = getDb();
    const result = db
      .prepare(
        'INSERT INTO custom_commands (project_id, name, command, sort_order) VALUES (?, ?, ?, ?)'
      )
      .run(projectId, name, command, sortOrder);

    const newCommand = db
      .prepare('SELECT * FROM custom_commands WHERE id = ?')
      .get(result.lastInsertRowid) as CustomCommand;

    response.json({ success: true, data: newCommand });
  });

  // Update a custom command
  router.put('/:id', (request, response) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) {
      throw new AppError('Invalid command id', { code: 'INVALID_ID', statusCode: 400 });
    }

    const body = readBody(request);
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM custom_commands WHERE id = ?')
      .get(id) as CustomCommand | undefined;

    if (!existing) {
      throw new AppError('Command not found', { code: 'NOT_FOUND', statusCode: 404 });
    }

    const name = body.name !== undefined ? readRequiredString(body.name, 'name') : existing.name;
    const command =
      body.command !== undefined ? readRequiredString(body.command, 'command') : existing.command;
    const sortOrder = body.sortOrder !== undefined ? readOptionalNumber(body.sortOrder) : existing.sort_order;

    db.prepare('UPDATE custom_commands SET name = ?, command = ?, sort_order = ? WHERE id = ?')
      .run(name, command, sortOrder, id);

    const updated = db.prepare('SELECT * FROM custom_commands WHERE id = ?').get(id) as CustomCommand;
    response.json({ success: true, data: updated });
  });

  // Delete a custom command
  router.delete('/:id', (request, response) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) {
      throw new AppError('Invalid command id', { code: 'INVALID_ID', statusCode: 400 });
    }

    const db = getDb();
    const result = db.prepare('DELETE FROM custom_commands WHERE id = ?').run(id);

    if (result.changes === 0) {
      throw new AppError('Command not found', { code: 'NOT_FOUND', statusCode: 404 });
    }

    response.json({ success: true });
  });

  // Execute a custom command (GET for SSE compatibility with EventSource)
  router.get('/:id/execute', (request, response) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) {
      throw new AppError('Invalid command id', { code: 'INVALID_ID', statusCode: 400 });
    }

    const db = getDb();
    const command = db
      .prepare('SELECT * FROM custom_commands WHERE id = ?')
      .get(id) as CustomCommand | undefined;

    if (!command) {
      throw new AppError('Command not found', { code: 'NOT_FOUND', statusCode: 404 });
    }

    // Get project path
    const project = db
      .prepare('SELECT project_path FROM projects WHERE project_id = ?')
      .get(command.project_id) as { project_path: string } | undefined;

    if (!project) {
      throw new AppError('Project not found', { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
    }

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const child = spawn('sh', ['-c', command.command], {
      cwd: project.project_path,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb' },
    });

    let killed = false;

    const sendEvent = (event: string, data: string) => {
      if (!killed) {
        // Named SSE events so EventSource/fetch clients can listen by event type.
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      sendEvent('stdout', chunk.toString());
    });

    child.stderr.on('data', (chunk: Buffer) => {
      sendEvent('stderr', chunk.toString());
    });

    child.on('close', (code) => {
      sendEvent('close', String(code ?? 1));
      if (!killed) {
        response.end();
      }
    });

    child.on('error', (error) => {
      sendEvent('error', error.message);
      if (!killed) {
        response.end();
      }
    });

    request.on('close', () => {
      killed = true;
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    });
  });

  return router;
}
