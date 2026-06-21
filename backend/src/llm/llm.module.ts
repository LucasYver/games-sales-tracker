import { Module } from '@nestjs/common';
import { LlmExtractorService } from './llm-extractor.service';

@Module({
  providers: [LlmExtractorService],
  exports: [LlmExtractorService],
})
export class LlmModule {}
