import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SuccessMessageEnum } from '../../shared/global/enums';
import { FxRatesResponseDto } from '../../shared/global/schemas';
import { FxService } from './fx.service';

@ApiTags('FX')
@Controller({ path: 'fx', version: '1' })
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rates')
  @ApiOperation({
    summary: 'Current conversion rates between every supported stablecoin',
  })
  @ApiOkResponse({ type: FxRatesResponseDto })
  async getRates() {
    const snapshot = await this.fxService.getSnapshot();
    return {
      message: SuccessMessageEnum.RATES_FETCHED,
      data: this.fxService.ratesView(snapshot),
    };
  }
}
