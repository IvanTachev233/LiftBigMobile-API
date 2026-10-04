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
  ParseUUIDPipe,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { ProgramsService } from './programs.service';
import {
  CreateProgramDto,
  UpdateProgramDto,
  AddProgramSetDto,
  PatchProgramSetDto,
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
  create(@Body() dto: CreateProgramDto, @Request() req: AuthenticatedRequest) {
    return this.programsService.create(dto, req.user.id);
  }

  @Get('upcoming')
  @UseGuards(RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: "Get client's upcoming programs" })
  findUpcoming(@Request() req: AuthenticatedRequest) {
    return this.programsService.findUpcoming(req.user.id);
  }

  @Get('client/:clientId')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Get all programs for a specific client' })
  findByClient(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.programsService.findByClient(clientId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific program' })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.programsService.findOne(id, req.user.id, req.user.role);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Update a program' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.programsService.update(id, dto, req.user.id);
  }

  @Post(':id/exercises/:cardId/sets')
  @UseGuards(RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: 'Client adds a set to a card of their program' })
  addSet(
    @Param('id', ParseUUIDPipe) programId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: AddProgramSetDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.programsService.addSet(programId, cardId, dto, req.user.id);
  }

  @Patch(':id/sets/:setId')
  @UseGuards(RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: 'Client logs a result on a set of their program' })
  updateSet(
    @Param('id', ParseUUIDPipe) programId: string,
    @Param('setId', ParseUUIDPipe) setId: string,
    @Body() dto: PatchProgramSetDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.programsService.updateSet(programId, setId, dto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Delete a program' })
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.programsService.remove(id, req.user.id);
  }
}
