import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KebabString = z.string().regex(KEBAB_CASE, 'must be kebab-case');

export const BootstrapEntrySchema = z
  .object({
    entry_type: z.enum(['decision', 'integration_point', 'structure']),
    tags: z.array(KebabString).min(2).max(5),
    files_modified: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1).max(5000),
    relates_to: z.array(KebabString).optional(),
  })
  .strict();

export type BootstrapEntry = z.infer<typeof BootstrapEntrySchema>;

export function formatZodIssue(issue: z.ZodIssue, itemIndex: number): string {
  const path = [`[${itemIndex}]`, ...issue.path.map(String)].join('.');

  if (issue.code === 'invalid_type') {
    return `${path}: expected ${issue.expected}, received ${issue.received}`;
  }

  if (issue.code === 'invalid_enum_value') {
    return `${path}: expected one of ${issue.options.join(', ')}, received ${String(issue.received)}`;
  }

  if (issue.code === 'too_small') {
    const typeLabel = issue.type === 'array' ? 'items' : issue.type;
    return `${path}: expected at least ${issue.minimum} ${typeLabel}`;
  }

  if (issue.code === 'too_big') {
    const typeLabel = issue.type === 'array' ? 'items' : issue.type;
    return `${path}: expected at most ${issue.maximum} ${typeLabel}`;
  }

  if (issue.code === 'unrecognized_keys') {
    return `${path}: unexpected field(s): ${issue.keys.join(', ')}`;
  }

  return `${path}: ${issue.message}`;
}

export function validateBootstrapItems(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return ['[root]: expected an array of bootstrap items'];
  }

  const errors: string[] = [];

  input.forEach((item, index) => {
    const result = BootstrapEntrySchema.safeParse(item);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(formatZodIssue(issue, index));
      }
    }
  });

  return errors;
}

async function main(): Promise<void> {
  const filePath = process.argv[2];

  if (!filePath) {
    process.stderr.write(
      'Usage: node --loader ts-node/esm scripts/validate-bootstrap.ts <bootstrap.json>\n',
    );
    process.exit(1);
  }

  let parsed: unknown;

  try {
    const content = await readFile(filePath, 'utf8');
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to read or parse JSON file: ${message}\n`);
    process.exit(1);
  }

  const errors = validateBootstrapItems(parsed);

  if (errors.length > 0) {
    process.stderr.write('Bootstrap validation failed:\n');
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exit(1);
  }

  const count = Array.isArray(parsed) ? parsed.length : 0;
  process.stdout.write(`Bootstrap validation passed (${count} item${count === 1 ? '' : 's'}).\n`);
}

if (process.env['JEST_WORKER_ID'] === undefined) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unexpected validation failure: ${message}\n`);
    process.exit(1);
  });
}
