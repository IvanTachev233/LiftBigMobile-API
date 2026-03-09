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
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutDto, UpdateWorkoutDto } from './dto/workout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('workouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  create(@Body() createWorkoutDto: CreateWorkoutDto, @Request() req) {
    return this.workoutsService.create(createWorkoutDto, req.user);
  }

  @Get('exercises')
  findAllExercises() {
    return this.workoutsService.findAllExercises();
  }

  @Get()
  findAll(@Request() req) {
    return this.workoutsService.findAll(req.user);
  }

  @Get('upcoming')
  findUpcoming(@Request() req) {
    return this.workoutsService.findUpcoming(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.workoutsService.findOne(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWorkoutDto: UpdateWorkoutDto,
    @Request() req,
  ) {
    return this.workoutsService.update(id, updateWorkoutDto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.workoutsService.remove(id, req.user);
  }
}
