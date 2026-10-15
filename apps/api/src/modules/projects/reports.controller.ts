/// <reference types="multer" />
import { Body, Controller, Get, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReqMeta, RequestMeta } from '../../common/request-meta';
import { AuthContext, CurrentAuth } from '../auth/auth.decorators';
import { SendReportDto } from './dto';
import { apiBase } from './projects.controller';
import { ReportsService } from './reports.service';

/** Signalements (écrans 21 et 27) : problème lié à un projet ou problème général, image facultative. */
@ApiTags('Signalements')
@ApiBearerAuth()
@Controller('v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  // Limite large ici : la taille réelle est contrôlée par le service (MEDIA_MAX_UPLOAD_MB) avec un message clair.
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        projectId: { type: 'string', format: 'uuid' },
        day: { type: 'string', example: '2026-10-14' },
        taskId: { type: 'string', format: 'uuid' },
        reason: { type: 'string', enum: ['unavailable', 'too_hard', 'health', 'content', 'other', 'app', 'product'] },
        message: { type: 'string', maxLength: 1000 },
        image: { type: 'string', format: 'binary', description: 'JPEG, PNG ou WebP ; ré-encodée, métadonnées supprimées' },
      },
    },
  })
  @ApiOperation({ summary: 'Envoyer un signalement, avec une image facultative (capture d’écran, photo d’un produit)' })
  send(@CurrentAuth() a: AuthContext, @Body() dto: SendReportDto, @UploadedFile() image: Express.Multer.File | undefined, @ReqMeta() meta: RequestMeta) {
    return this.reports.send(a.userId, dto, image, meta);
  }

  @Get()
  @ApiQuery({ name: 'projectId', required: false })
  @ApiOperation({ summary: 'Mes signalements, leur statut et la réponse du support' })
  mine(@CurrentAuth() a: AuthContext, @Req() req: Request, @Query('projectId') projectId?: string) {
    return this.reports.mine(a.userId, apiBase(req), projectId || undefined);
  }
}
