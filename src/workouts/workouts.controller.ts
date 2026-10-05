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
  ParseUUIDPipe,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { WorkoutsService } from './workouts.service';
import {
  CreateWorkoutDto,
  UpdateWorkoutDto,
  CreateExerciseDto,
  AddSetDto,
  SetResultDto,
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
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.findOne(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateWorkoutDto: UpdateWorkoutDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.update(id, updateWorkoutDto, req.user);
  }

  @Post(':id/cards/:cardId/sets')
  @ApiOperation({ summary: 'Add a set to a card of an own workout' })
  addSet(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: AddSetDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.addSet(id, cardId, dto, req.user);
  }

  @Patch(':id/sets/:setId')
  @ApiOperation({ summary: 'Log the result of a set of an own workout' })
  updateSetResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('setId', ParseUUIDPipe) setId: string,
    @Body() dto: SetResultDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.updateSetResult(id, setId, dto, req.user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.workoutsService.remove(id, req.user);
  }
}
