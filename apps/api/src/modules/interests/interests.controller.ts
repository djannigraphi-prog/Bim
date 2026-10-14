import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { asc, eq } from 'drizzle-orm';
import { DB, Database } from '../../database/database.module';
import { interests } from '../../database/schema';
import { Public } from '../auth/auth.decorators';

@ApiTags('Référentiels')
@Controller('v1/interests')
export class InterestsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Centres d'intérêt proposés à l'inscription (écran 05). */
  @Public()
  @Get()
  @ApiOkResponse({ description: 'Liste ordonnée des centres d’intérêt actifs' })
  async list() {
    const rows = await this.db
      .select({ code: interests.code, label: interests.label, icon: interests.icon })
      .from(interests)
      .where(eq(interests.active, true))
      .orderBy(asc(interests.sortOrder));
    return { items: rows };
  }
}
