/**
 * Table tests for the guards that validate published data: each row changes
 * a deep copy of a valid fixture and states whether the guard still accepts
 * it. The rows pin which values a guard accepts and refuses, field by field.
 */
export type FixtureChange = (value: any) => void;

export type GuardCase = readonly [label: string, change: FixtureChange, accepted: boolean];

/** What `guard` answers for a deep copy of `base` after `change`. */
export function guardAfterChange(base: unknown, change: FixtureChange, guard: (value: unknown) => boolean): boolean {
  const value = structuredClone(base);
  change(value);
  return guard(value);
}

/** One refusal per required field: the copy without that field. */
export function withoutEachField(fields: readonly string[]): GuardCase[] {
  return fields.map((field) => [`without ${field}`, (value) => { delete value[field]; }, false]);
}

/** The cases as named rows, so a test title shows the label and the verdict. */
export function guardRows(cases: readonly GuardCase[]) {
  return cases.map(([label, change, accepted]) => ({ label, change, accepted }));
}
