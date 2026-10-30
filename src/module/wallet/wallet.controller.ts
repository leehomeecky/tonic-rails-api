import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UuidParamPipe } from '../../shared/global/decorators';
import { SuccessMessageEnum } from '../../shared/global/enums';
import {
  CreateWalletDto,
  ErrorResponseDto,
  WalletBalancesResponseDto,
  WalletResponseDto,
} from '../../shared/global/schemas';
import { WalletService } from './wallet.service';

@ApiTags('Wallets')
@Controller({ path: 'wallets', version: '1' })
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a wallet with exactly one of email or phone',
  })
  @ApiCreatedResponse({ type: WalletResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'WALLET_ALREADY_EXISTS',
  })
  async create(@Body() body: CreateWalletDto) {
    const data = await this.walletService.createWallet(body);
    return { message: SuccessMessageEnum.WALLET_CREATED, data };
  }

  @Get(':walletId')
  @ApiOperation({ summary: 'Get a wallet and its balances' })
  @ApiOkResponse({ type: WalletResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async get(@Param('walletId', UuidParamPipe) walletId: string) {
    const data = await this.walletService.getWallet(walletId);
    return { message: SuccessMessageEnum.WALLET_FETCHED, data };
  }

  @Get(':walletId/balances')
  @ApiOperation({
    summary: 'All balances plus their total equivalent in USD',
  })
  @ApiOkResponse({ type: WalletBalancesResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async balances(@Param('walletId', UuidParamPipe) walletId: string) {
    const data = await this.walletService.getBalances(walletId);
    return { message: SuccessMessageEnum.BALANCES_FETCHED, data };
  }
}
