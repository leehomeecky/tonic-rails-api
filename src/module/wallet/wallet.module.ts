import { Module } from '@nestjs/common';
import {
  BalanceRepository,
  WalletRepository,
} from '../../shared/global/model/repositories';
import { FxModule } from '../fx/fx.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [FxModule],
  controllers: [WalletController],
  providers: [WalletService, WalletRepository, BalanceRepository],
  exports: [WalletService, WalletRepository],
})
export class WalletModule {}
