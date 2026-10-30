import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SuccessMessageEnum } from '../../shared/global/enums';
import {
  ErrorResponseDto,
  TransactionResponseDto,
} from '../../shared/global/schemas';
import { TransactionQueryService } from './transaction-query.service';

@ApiTags('Transactions')
@Controller({ path: 'transactions', version: '1' })
export class TransactionController {
  constructor(private readonly queries: TransactionQueryService) {}

  @Get(':transactionId')
  @ApiOperation({ summary: 'Fetch a single transaction by id or reference' })
  @ApiParam({
    name: 'transactionId',
    description: 'Transaction UUID or reference (e.g. TR-20261029-7F3K9QAB)',
  })
  @ApiOkResponse({ type: TransactionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async getOne(@Param('transactionId') transactionId: string) {
    const data = await this.queries.getOne(transactionId);
    return { message: SuccessMessageEnum.TRANSACTION_FETCHED, data };
  }
}
