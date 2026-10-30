import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../shared/global/constants';
import { IdempotencyKey, UuidParamPipe } from '../../shared/global/decorators';
import { SuccessMessageEnum } from '../../shared/global/enums';
import {
  DepositDto,
  ErrorResponseDto,
  SwapDto,
  TransactionHistoryQueryDto,
  TransactionListResponseDto,
  TransactionResponseDto,
  TransferDto,
} from '../../shared/global/schemas';
import { IdempotentResponse } from '../idempotency/idempotency.service';
import { TransactionQueryService } from './transaction-query.service';
import { TransactionEnvelope, TransactionService } from './transaction.service';

const IdempotencyHeader = ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description:
    'Unique per logical request (UUID v4 recommended). Retries with the same key and body replay the original response.',
});

@ApiTags('Wallet transactions')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@Controller({ path: 'wallets/:walletId', version: '1' })
export class WalletTransactionController {
  constructor(
    private readonly transactions: TransactionService,
    private readonly queries: TransactionQueryService,
  ) {}

  @Post('deposits')
  @IdempotencyHeader
  @ApiOperation({ summary: 'Simulated deposit of any supported stablecoin' })
  @ApiCreatedResponse({ type: TransactionResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  async deposit(
    @Param('walletId', UuidParamPipe) walletId: string,
    @IdempotencyKey() key: string,
    @Body() body: DepositDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      await this.transactions.deposit(walletId, body, key),
    );
  }

  @Post('swaps')
  @IdempotencyHeader
  @ApiOperation({
    summary: 'Swap one stablecoin for another inside the same wallet',
  })
  @ApiCreatedResponse({ type: TransactionResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'INSUFFICIENT_FUNDS, AMOUNT_TOO_SMALL, IDEMPOTENCY_KEY_REUSED',
  })
  async swap(
    @Param('walletId', UuidParamPipe) walletId: string,
    @IdempotencyKey() key: string,
    @Body() body: SwapDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.transactions.swap(walletId, body, key));
  }

  @Post('transfers')
  @IdempotencyHeader
  @ApiOperation({
    summary:
      'Send to another wallet; converts automatically when currencies differ',
  })
  @ApiCreatedResponse({ type: TransactionResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  async transfer(
    @Param('walletId', UuidParamPipe) walletId: string,
    @IdempotencyKey() key: string,
    @Body() body: TransferDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      await this.transactions.transfer(walletId, body, key),
    );
  }

  @Get('transactions')
  @ApiOperation({
    summary:
      'Transaction history (sent and received), newest first, keyset-paginated',
  })
  @ApiOkResponse({ type: TransactionListResponseDto })
  async history(
    @Param('walletId', UuidParamPipe) walletId: string,
    @Query() query: TransactionHistoryQueryDto,
  ) {
    const { data, meta } = await this.queries.list(walletId, query);
    return { message: SuccessMessageEnum.TRANSACTIONS_FETCHED, data, meta };
  }

  private respond(
    res: Response,
    result: IdempotentResponse<TransactionEnvelope>,
  ): TransactionEnvelope {
    res.status(result.statusCode);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }
}
