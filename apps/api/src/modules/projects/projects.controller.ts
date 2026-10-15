/// <reference types="multer" />
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProjectPhotosService } from './photos.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth, RequireSpace } from '../auth/auth.decorators';
import { AddTaskDto, CreateProjectDto, MeasurementDto, PauseDto, ReportDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';
import { ReportsService } from './reports.service';

/** Projets BIM (lot 1). Réservé à l'espace utilisateur : dans l'espace marchand, « + » ajoute un article (E15). */
@ApiTags('Projets')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly photos: ProjectPhotosService,
    private readonly reports: ReportsService,
  ) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Catégories, objectifs, durées, budgets indicatifs et limite (écrans 19 à 23)' })
  catalog() {
    return this.projects.catalog();
  }

  @Get()
  @ApiOperation({ summary: 'Mes projets (écran 18)' })
  list(@CurrentAuth() a: AuthContext) {
    return this.projects.list(a.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Créer un projet et son programme (écrans 19 à 24) ; aucun paiement (F4)' })
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateProjectDto, @ReqMeta() meta: RequestMeta) {
    return this.projects.create(a.userId, dto, meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Projet, programme et carte des jours (écrans 24 et 26)' })
  detail(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.detail(a.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renommer le projet ou le rendre public / privé' })
  update(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(a.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer (abandonner) le projet ; historique conservé (E6)' })
  async abandon(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.projects.abandon(a.userId, id, meta);
  }

  @Get(':id/days/:day')
  @ApiOperation({ summary: 'Journée du projet (écran 27)' })
  day(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('day') day: string) {
    return this.projects.day(a.userId, id, day);
  }

  @Put(':id/days/:day/tasks/:taskId/done')
  @ApiOperation({ summary: 'Cocher une tâche du jour' })
  check(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('day') day: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.projects.setCompletion(a.userId, id, taskId, day, true);
  }

  @Delete(':id/days/:day/tasks/:taskId/done')
  @ApiOperation({ summary: 'Décocher une tâche du jour' })
  uncheck(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('day') day: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.projects.setCompletion(a.userId, id, taskId, day, false);
  }

  @Post(':id/tasks')
  @ApiOperation({ summary: 'Ajouter une tâche au programme' })
  addTask(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTaskDto) {
    return this.projects.addTask(a.userId, id, dto);
  }

  @Delete(':id/tasks/:taskId')
  @ApiOperation({ summary: 'Retirer une tâche du programme (les jours déjà cochés restent)' })
  removeTask(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.projects.removeTask(a.userId, id, taskId);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mettre en pause (écran 29) ; la fin prévue est décalée' })
  pause(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PauseDto, @ReqMeta() meta: RequestMeta) {
    return this.projects.pause(a.userId, id, dto, meta);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reprendre avant la fin de la pause' })
  resume(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.resume(a.userId, id);
  }

  @Post(':id/measurements')
  @ApiOperation({ summary: 'Noter une mesure (ex. poids) pour un objectif chiffré ; privée' })
  measure(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MeasurementDto) {
    return this.projects.addMeasurement(a.userId, id, dto);
  }

  @Post(':id/reports')
  @ApiOperation({ summary: 'Signaler un problème sur une journée ou une tâche (écran 27) ; voir aussi POST /v1/reports' })
  report(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportDto, @ReqMeta() meta: RequestMeta) {
    return this.reports.send(a.userId, { ...dto, projectId: id }, undefined, meta);
  }

  @Get(':id/reports')
  @ApiOperation({ summary: 'Mes signalements sur ce projet et les réponses du support' })
  reportsOf(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.reports.mine(a.userId, apiBase(req), id);
  }

  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Photo « avant » ou « après » (écrans 22 et 31), privée ; ?kind=before|after' })
  addPhoto(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('kind') kind: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
  ) {
    return this.photos.upload(a.userId, id, kind, file, meta, apiBase(req));
  }

  @Get(':id/photos')
  @ApiOperation({ summary: 'Mes photos du projet, avec des liens temporaires' })
  listPhotos(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.photos.list(a.userId, id, apiBase(req));
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  async deletePhoto(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @ReqMeta() meta: RequestMeta) {
    await this.photos.remove(a.userId, id, photoId, meta);
  }
}

export function apiBase(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}
