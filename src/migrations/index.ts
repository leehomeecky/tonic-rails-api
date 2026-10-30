import { InitialSchema1793232000000 } from './1793232000000-InitialSchema';
import { SeedReferenceData1793232000001 } from './1793232000001-SeedReferenceData';

/** Registered as classes (not globs) so they load identically under ts-jest and from dist. */
export const MIGRATIONS = [
  InitialSchema1793232000000,
  SeedReferenceData1793232000001,
];
