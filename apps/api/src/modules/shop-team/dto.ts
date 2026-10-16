import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsString, Length } from 'class-validator';
import { SHOP_PERMISSIONS, ShopPermission } from '../../database/schema';

export class InviteMemberDto {
  @ApiProperty({ example: 'awa.kone', description: 'Nom d’utilisateur de la personne invitée' }) @IsString() @Length(2, 40) username!: string;
}

export class MemberPermissionsDto {
  @ApiProperty({ enum: SHOP_PERMISSIONS, isArray: true, description: 'Ensemble complet des permissions de l’employé (remplace le précédent)' })
  @IsArray()
  @ArrayMaxSize(SHOP_PERMISSIONS.length)
  @IsIn(SHOP_PERMISSIONS, { each: true })
  permissions!: ShopPermission[];
}
