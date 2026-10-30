import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan } from 'typeorm';
import { FxSourceEnum } from '../../enums';
import { FxRateSnapshot } from '../entities';
import { AbstractRepository } from './abstract.repository';

@Injectable()
export class FxRateSnapshotRepository extends AbstractRepository<FxRateSnapshot> {
  constructor(dataSource: DataSource) {
    super(FxRateSnapshot, dataSource);
  }

  findLatestLiveSince(since: Date): Promise<FxRateSnapshot | null> {
    return this.findOne({
      where: { source: FxSourceEnum.LIVE, fetchedAt: MoreThan(since) },
      order: { fetchedAt: 'DESC' },
    });
  }
}
