import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenCodeDefinitionFromVerboseModels,
  buildOpenCodeDefinitionFromIds,
  ensureOpenCodeFreeModels,
  mergeOpenCodeDefinitionWithIds,
  parseOpenCodeModelsStdout,
  parseOpenCodeVerboseModelsStdout,
} from '@/modules/providers/list/opencode/opencode-models.provider.js';

test('OpenCode models provider parses plain CLI output and removes duplicates', () => {
  const ids = parseOpenCodeModelsStdout(`
opencode/big-pickle
not a model
anthropic/claude-opus-4-7-fast
anthropic/claude-opus-4-7-fast
openai/gpt-5.5-pro
`);

  assert.deepEqual(ids, [
    'opencode/big-pickle',
    'anthropic/claude-opus-4-7-fast',
    'openai/gpt-5.5-pro',
  ]);
});

test('OpenCode models provider parses JSON array CLI output', () => {
  const ids = parseOpenCodeModelsStdout(JSON.stringify([
    { id: 'deepseek-v4-flash-free', providerID: 'opencode', name: 'DeepSeek V4 Flash Free' },
    { id: 'gpt-5.5-pro', providerId: 'openai' },
    'opencode/big-pickle',
  ]));

  assert.deepEqual(ids, [
    'opencode/deepseek-v4-flash-free',
    'openai/gpt-5.5-pro',
    'opencode/big-pickle',
  ]);
});

test('OpenCode models provider formats frontend labels and keeps free models selectable', () => {
  const definition = buildOpenCodeDefinitionFromIds([
    'opencode/deepseek-v4-flash-free',
    'opencode/nemotron-3-super-free',
    'anthropic/claude-3-5-sonnet-20241022',
    'anthropic/claude-opus-4-7-fast',
    'google/model-alpha',
    'openai/gpt-5.4-mini-fast',
    'openai/gpt-5.5-pro',
    'newprovider/alpha-v12-special-20261231',
  ]);

  assert.deepEqual(definition.OPTIONS.map((option) => option.value), [
    'opencode/deepseek-v4-flash-free',
    'opencode/nemotron-3-super-free',
    'anthropic/claude-3-5-sonnet-20241022',
    'anthropic/claude-opus-4-7-fast',
    'google/model-alpha',
    'openai/gpt-5.4-mini-fast',
    'openai/gpt-5.5-pro',
    'newprovider/alpha-v12-special-20261231',
  ]);
  assert.equal(definition.DEFAULT, 'opencode/deepseek-v4-flash-free');
  assert.deepEqual(definition.OPTIONS[0], {
    value: 'opencode/deepseek-v4-flash-free',
    label: 'Deepseek V4 Flash Free',
    description: 'opencode - opencode/deepseek-v4-flash-free',
  });
  assert.deepEqual(definition.OPTIONS[1], {
    value: 'opencode/nemotron-3-super-free',
    label: 'Nemotron 3 Super Free',
    description: 'opencode - opencode/nemotron-3-super-free',
  });
});

test('OpenCode models provider maps verbose model variants to effort options', () => {
  const models = parseOpenCodeVerboseModelsStdout(`
opencode/deepseek-v4-flash-free
{
  "id": "deepseek-v4-flash-free",
  "providerID": "opencode",
  "name": "DeepSeek V4 Flash Free",
  "variants": {
    "low": {
      "reasoningEffort": "low"
    },
    "high": {
      "reasoningEffort": "high"
    }
  }
}
anthropic/claude-sonnet-5
{
  "id": "claude-sonnet-5",
  "providerID": "anthropic",
  "name": "Claude Sonnet 5",
  "variants": {
    "low": {
      "effort": "low"
    },
    "max": {
      "effort": "max"
    }
  }
}
google/model-alpha
{
  "id": "model-alpha",
  "providerID": "google",
  "name": "Model Alpha"
}
`);

  const definition = buildOpenCodeDefinitionFromVerboseModels(models);

  assert.deepEqual(definition.OPTIONS, [
    {
      value: 'opencode/deepseek-v4-flash-free',
      label: 'DeepSeek V4 Flash Free',
      description: 'opencode - opencode/deepseek-v4-flash-free',
      effort: {
        values: [
          { value: 'low' },
          { value: 'high' },
        ],
      },
    },
    {
      value: 'anthropic/claude-sonnet-5',
      label: 'Claude Sonnet 5',
      description: 'anthropic - anthropic/claude-sonnet-5',
      effort: {
        values: [
          { value: 'low' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'google/model-alpha',
      label: 'Model Alpha',
      description: 'google - google/model-alpha',
    },
  ]);
});

test('OpenCode models provider merges plain ids missing from verbose blocks', () => {
  const verboseDefinition = buildOpenCodeDefinitionFromVerboseModels([
    {
      id: 'claude-sonnet-5',
      providerID: 'anthropic',
      name: 'Claude Sonnet 5',
    },
  ]);

  const merged = mergeOpenCodeDefinitionWithIds(verboseDefinition, [
    'opencode/deepseek-v4-flash-free',
    'anthropic/claude-sonnet-5',
  ]);

  assert.deepEqual(merged.OPTIONS.map((option) => option.value), [
    'opencode/deepseek-v4-flash-free',
    'anthropic/claude-sonnet-5',
  ]);
  assert.equal(merged.DEFAULT, 'anthropic/claude-sonnet-5');
});

test('OpenCode models provider always keeps Zen free models selectable', () => {
  const definition = ensureOpenCodeFreeModels(
    buildOpenCodeDefinitionFromIds([
      'anthropic/claude-sonnet-5',
      'openai/gpt-5.5-pro',
      'openrouter/anthropic/claude-sonnet-4-5',
    ]),
  );

  const values = definition.OPTIONS.map((option) => option.value);
  assert.ok(values.includes('opencode/big-pickle'));
  assert.ok(values.includes('opencode/deepseek-v4-flash-free'));
  assert.ok(values.includes('opencode/nemotron-3-super-free'));
  assert.ok(values.includes('opencode/gpt-5-nano'));
  assert.ok(values.includes('opencode/minimax-m2.5-free'));
  assert.equal(values[0], 'opencode/big-pickle');
  assert.ok(values.includes('anthropic/claude-sonnet-5'));
  assert.ok(values.includes('openrouter/anthropic/claude-sonnet-4-5'));
  assert.equal(definition.DEFAULT, 'anthropic/claude-sonnet-5');
});

test('OpenCode models provider keeps multi-segment paid model ids', () => {
  const ids = parseOpenCodeModelsStdout(`
opencode/big-pickle
openrouter/anthropic/claude-sonnet-4-5
openai/gpt-5.5-pro
not a model
`);

  assert.deepEqual(ids, [
    'opencode/big-pickle',
    'openrouter/anthropic/claude-sonnet-4-5',
    'openai/gpt-5.5-pro',
  ]);

  const definition = buildOpenCodeDefinitionFromIds(ids);
  assert.deepEqual(definition.OPTIONS.map((option) => option.value), [
    'opencode/big-pickle',
    'openrouter/anthropic/claude-sonnet-4-5',
    'openai/gpt-5.5-pro',
  ]);
});
