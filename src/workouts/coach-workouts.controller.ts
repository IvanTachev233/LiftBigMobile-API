import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CoachWorkoutsService } from './coach-workouts.service';
import {
  CreateCoachWorkoutDto,
  UpdateCoachWorkoutDto,
} from './dto/coach-workout.dto';

@ApiTags('coach')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COACH')
@Controller('coach')
export class CoachWorkoutsController {
  constructor(private readonly coachWorkoutsService: CoachWorkoutsService) {}

  @Get('clients/:clientId/workouts')
  @ApiOperation({ summary: 'List the workouts the caller assigned a client' })
  findForClient(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.coachWorkoutsService.findForClient(clientId, req.user);
  }

  @Post('clients/:clientId/workouts')
  @ApiOperation({ summary: 'Assign a planned workout to a client' })
  createForClient(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateCoachWorkoutDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.coachWorkoutsService.createForClient(clientId, dto, req.user);
  }

  @Get('workouts/:id')
  @ApiOperation({ summary: 'Get a workout the caller assigned' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.coachWorkoutsService.findOne(id, req.user);
  }

  @Put('workouts/:id')
  @ApiOperation({ summary: 'Edit the plan of a workout the caller assigned' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoachWorkoutDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.coachWorkoutsService.update(id, dto, req.user);
  }

  @Delete('workouts/:id')
  @ApiOperation({ summary: 'Delete a workout the caller assigned' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.coachWorkoutsService.remove(id, req.user);
  }
}
