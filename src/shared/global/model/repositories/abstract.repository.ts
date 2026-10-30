import {
  DataSource,
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';

export abstract class AbstractRepository<
  TEntity extends ObjectLiteral,
> extends Repository<TEntity> {
  constructor(entity: EntityTarget<TEntity>, dataSource: DataSource) {
    super(entity, dataSource.createEntityManager());
  }

  getOneByColumn(
    where: FindOptionsWhere<TEntity> | FindOptionsWhere<TEntity>[],
    relations?: string[],
  ): Promise<TEntity | null> {
    return this.findOne({ where, relations });
  }

  getColumnCount(
    where: FindOptionsWhere<TEntity> | FindOptionsWhere<TEntity>[],
  ): Promise<number> {
    return this.count({ where });
  }

  /** Same repository bound to a transaction's EntityManager. */
  withManager(manager: EntityManager): Repository<TEntity> {
    return manager.getRepository<TEntity>(this.target);
  }
}
