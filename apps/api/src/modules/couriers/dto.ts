import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class CourierApplicationDto {
  @ApiPropertyOptional({ enum: ['cni', 'passport', 'permis'] }) @IsOptional() @IsIn(['cni', 'passport', 'permis']) idDocType?: string;
  @ApiPropertyOptional({ enum: ['moto', 'velo', 'voiture', 'pied'] }) @IsOptional() @IsIn(['moto', 'velo', 'voiture', 'pied']) vehicle?: string;
}

export class CourierProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() available?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(20) capacity?: number;
  @ApiPropertyOptional({ enum: ['moto', 'velo', 'voiture', 'pied'] }) @IsOptional() @IsIn(['moto', 'velo', 'voiture', 'pied']) vehicle?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @Matches(/^[a-z0-9-]{3,80}$/, { each: true }) communes?: string[];
}

export class InviteCourierDto {
  @ApiProperty() @IsString() @Length(2, 40) username!: string;
  @ApiProperty({ enum: ['employee', 'partner'] }) @IsIn(['employee', 'partner']) relation!: 'employee' | 'partner';
}

export class RejectCourierDto {
  @ApiProperty() @IsString() @Length(5, 300) reason!: string;
}
