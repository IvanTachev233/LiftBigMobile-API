import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateEnrollmentDto,
  RecalculateEnrollmentDto,
} from './dto/enrollment.dto';
import { EnrollmentService } from './enrollment.service';

@ApiTags('programs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CLIENT')
@Controller('program-enrollments')
export class ProgramEnrollmentsController {
  constructor(private readonly enrollments: EnrollmentService) {}

  @Post()
  @ApiOperation({ summary: 'Start a program, creating its workouts' })
  enroll(
    @Body() dto: CreateEnrollmentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.enrollments.enroll(req.user, dto);
  }

  @Get('active')
  @ApiOperation({ summary: 'The active enrollment with its workouts, or null' })
  active(@Request() req: AuthenticatedRequest) {
    return this.enrollments.active(req.user);
  }

  @Post(':id/abandon')
  @ApiOperation({ summary: 'Abandon the program; deletes PLANNED workouts' })
  abandon(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.enrollments.abandon(req.user, id);
  }

  @Post(':id/recalculate')
  @ApiOperation({ summary: 'New maxes; rewrites targets of PLANNED workouts' })
  recalculate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecalculateEnrollmentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.enrollments.recalculate(req.user, id, dto);
  }
}
