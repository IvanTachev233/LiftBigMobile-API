import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BestLiftsQueryDto, CreateRepMaxDto } from './dto/lift.dto';
import { LiftRecordsService } from './lift-records.service';

@ApiTags('lifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lifts')
export class LiftsController {
  constructor(private readonly lifts: LiftRecordsService) {}

  @Get('best')
  @ApiOperation({ summary: 'Best 1RMs of the caller, in kg' })
  bests(
    @Query() query: BestLiftsQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.lifts.bests(req.user, query.exerciseIds);
  }

  @Get(':exerciseId/history')
  @ApiOperation({ summary: 'Best, latest 1/2/3RM and every rep max entry' })
  history(
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.lifts.history(req.user, exerciseId);
  }

  @Post('rep-maxes')
  @ApiOperation({ summary: 'Record a rep max by hand' })
  recordManual(
    @Body() dto: CreateRepMaxDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.lifts.recordManual(req.user, dto);
  }

  @Post('rep-maxes/from-set/:setId')
  @ApiOperation({ summary: 'Record a logged set as a rep max' })
  recordFromSet(
    @Param('setId', ParseUUIDPipe) setId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.lifts.recordFromSet(req.user, setId);
  }
}
