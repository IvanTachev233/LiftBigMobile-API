import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ProgramsService } from './programs.service';
import {
  CreateProgramDto,
  UpdateProgramDto,
  PatchProgramExerciseDto,
  AddExerciseSetDto,
} from './dto/program.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('programs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Create a program for a client' })
  create(@Body() dto: CreateProgramDto, @Request() req) {
    return this.programsService.create(dto, req.user.id);
  }

  @Get('upcoming')
  @UseGuards(RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: "Get client's upcoming programs" })
  findUpcoming(@Request() req) {
    return this.programsService.findUpcoming(req.user.id);
  }

  @Get('client/:clientId')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Get all programs for a specific client' })
  findByClient(@Param('clientId') clientId: string, @Request() req) {
    return this.programsService.findByClient(clientId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific program' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.programsService.findOne(id, req.user.id, req.user.role);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a program' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
    @Request() req,
  ) {
    return this.programsService.update(id, dto, req.user.id);
  }

  @Post(':id/exercises')
  @UseGuards(RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: 'Client adds an extra set to a program' })
  addExerciseSet(
    @Param('id') programId: string,
    @Body() dto: AddExerciseSetDto,
    @Request() req,
  ) {
    return this.programsService.addExerciseSet(programId, dto, req.user.id);
  }

  @Patch(':id/exercises/:exerciseId')
  @UseGuards(RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: 'Client logs exercise data' })
  patchExercise(
    @Param('id') programId: string,
    @Param('exerciseId') exerciseId: string,
    @Body() dto: PatchProgramExerciseDto,
    @Request() req,
  ) {
    return this.programsService.patchExercise(
      programId,
      exerciseId,
      dto,
      req.user.id,
    );
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a program' })
  remove(@Param('id') id: string, @Request() req) {
    return this.programsService.remove(id, req.user.id);
  }
}
