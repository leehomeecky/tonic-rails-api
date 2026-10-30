import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LedgerEntry } from '../entities';
import { AbstractRepository } from './abstract.repository';

@Injectable()
export class LedgerEntryRepository extends AbstractRepository<LedgerEntry> {
  constructor(dataSource: DataSource) {
    super(LedgerEntry, dataSource);
  }
}
