import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import type { DeliveryMode } from './pricing';

export class CommuneDto {
  @ApiProperty({ example: 'Abidjan' }) @IsString() @Length(2, 80) city!: string;
  @ApiProperty({ example: 'Cocody' }) @IsString() @Length(2, 80) name!: string;
}

export class CommuneStatusDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class DurationDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9-]{3,80}$/) fromCode!: string;
  @ApiProperty() @IsString() @Matches(/^[a-z0-9-]{3,80}$/) toCode!: string;
  @ApiProperty({ enum: ['express', 'economy'] }) @IsIn(['express', 'economy']) mode!: DeliveryMode;
  @ApiProperty({ nullable: true, description: 'Minutes ; null retire le trajet (livraison indisponible)' })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(2880)
  minutes!: number | null;
}

export class TariffDraftDto {
  @ApiProperty({ enum: ['express', 'economy'] }) @IsIn(['express', 'economy']) mode!: DeliveryMode;
  @ApiProperty() @IsInt() baseFcfa!: number;
  @ApiProperty() @IsInt() perMinuteFcfa!: number;
  @ApiProperty() @IsInt() minimumFcfa!: number;
  @ApiProperty() @IsInt() roundingFcfa!: number;
  @ApiProperty() @IsInt() freeWaitMinutes!: number;
  @ApiProperty() @IsInt() waitPerMinuteFcfa!: number;
  @ApiProperty() @IsInt() waitCapMinutes!: number;
}

export class QuoteQueryDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9-]{3,80}$/) commune!: string;
}

export class SimulateDto {
  @ApiProperty() @IsInt() minutes!: number;
}
