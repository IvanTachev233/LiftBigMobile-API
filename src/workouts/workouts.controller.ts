import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { WorkoutsService } from './workouts.service';
import {
  CreateWorkoutDto,
  UpdateWorkoutDto,
  CreateExerciseDto,
} from './dto/workout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('workouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  create(
    @Body() createWorkoutDto: CreateWorkoutDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.create(createWorkoutDto, req.user);
  }

  @Get('exercises')
  @ApiOperation({ summary: 'List exercises visible to the caller' })
  findAllExercises(@Request() req: AuthenticatedRequest) {
    return this.workoutsService.findAllExercises(req.user);
  }

  @Post('exercises')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a coach-owned exercise' })
  createExercise(
    @Body() dto: CreateExerciseDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.createExercise(dto, req.user);
  }

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.workoutsService.findAll(req.user);
  }

  @Get('upcoming')
  findUpcoming(@Request() req: AuthenticatedRequest) {
    return this.workoutsService.findUpcoming(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.workoutsService.findOne(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWorkoutDto: UpdateWorkoutDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.update(id, updateWorkoutDto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.workoutsService.remove(id, req.user);
  }
}
