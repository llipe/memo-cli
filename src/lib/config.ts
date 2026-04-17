import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MemoConfigSchema } from '../types/config.js';
import type { MemoConfig } from '../types/config.js';
import { MemoError } from './errors.js';

const CONFIG_FILENAME = 'memo.config.json';

export async function loadConfig(cwd: string = process.cwd()): Promise<MemoConfig> {
  const filePath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    throw new MemoError('CONFIG_NOT_FOUND', `Config file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new MemoError('CONFIG_INVALID', `Config file is not valid JSON: ${filePath}`);
  }

  const result = MemoConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new MemoError('CONFIG_INVALID', `Config is invalid: ${issues}`);
  }

  return result.data;
}

export async function writeConfig(config: MemoConfig, cwd: string = process.cwd()): Promise<void> {
  const filePath = join(cwd, CONFIG_FILENAME);
  await writeFile(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export interface ValidateConfigResult {
  valid: boolean;
  errors?: string[];
}

export async function validateConfig(cwd: string = process.cwd()): Promise<ValidateConfigResult> {
  const filePath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return { valid: false, errors: [`Config file not found: ${filePath}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { valid: false, errors: ['Config file is not valid JSON'] };
  }

  const result = MemoConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, errors };
  }

  return { valid: true };
}
