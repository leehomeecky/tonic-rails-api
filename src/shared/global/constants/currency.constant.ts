import { CurrencyEnum, IsoCurrencyEnum } from '../enums';

export interface CurrencyDefinition {
  code: CurrencyEnum;
  isoCode: IsoCurrencyEnum;
  name: string;
  decimals: number;
}

/** Every supported coin uses the on-chain stablecoin convention of 6 decimal places. */
export const MONEY_SCALE = 6;

/** Scale used when quantising an FX rate before it is applied and stored. */
export const RATE_SCALE = 18;

export const SUPPORTED_CURRENCIES: readonly CurrencyDefinition[] = [
  {
    code: CurrencyEnum.cNGN,
    isoCode: IsoCurrencyEnum.NGN,
    name: 'Nigerian Naira Stablecoin',
    decimals: MONEY_SCALE,
  },
  {
    code: CurrencyEnum.cGHS,
    isoCode: IsoCurrencyEnum.GHS,
    name: 'Ghanaian Cedi Stablecoin',
    decimals: MONEY_SCALE,
  },
  {
    code: CurrencyEnum.cXAF,
    isoCode: IsoCurrencyEnum.XAF,
    name: 'Central African CFA Franc Stablecoin',
    decimals: MONEY_SCALE,
  },
  {
    code: CurrencyEnum.USDx,
    isoCode: IsoCurrencyEnum.USD,
    name: 'US Dollar Stablecoin',
    decimals: MONEY_SCALE,
  },
  {
    code: CurrencyEnum.EURx,
    isoCode: IsoCurrencyEnum.EUR,
    name: 'Euro Stablecoin',
    decimals: MONEY_SCALE,
  },
];

export const CURRENCY_CODES: readonly CurrencyEnum[] = SUPPORTED_CURRENCIES.map(
  ({ code }) => code,
);

export const CURRENCY_TO_ISO: Readonly<Record<CurrencyEnum, IsoCurrencyEnum>> =
  {
    [CurrencyEnum.cNGN]: IsoCurrencyEnum.NGN,
    [CurrencyEnum.cGHS]: IsoCurrencyEnum.GHS,
    [CurrencyEnum.cXAF]: IsoCurrencyEnum.XAF,
    [CurrencyEnum.USDx]: IsoCurrencyEnum.USD,
    [CurrencyEnum.EURx]: IsoCurrencyEnum.EUR,
  };

export const USD_PEGGED_CURRENCY = CurrencyEnum.USDx;
