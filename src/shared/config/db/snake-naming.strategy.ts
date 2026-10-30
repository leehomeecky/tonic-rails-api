import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const toSnake = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** camelCase properties ⇄ snake_case columns, matching the hand-written migrations. */
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    return (
      embeddedPrefixes.map(toSnake).join('_') +
      (embeddedPrefixes.length ? '_' : '') +
      (customName ?? toSnake(propertyName))
    );
  }

  override relationName(propertyName: string): string {
    return toSnake(propertyName);
  }

  override joinColumnName(
    relationName: string,
    referencedColumnName: string,
  ): string {
    return toSnake(`${relationName}_${referencedColumnName}`);
  }
}
