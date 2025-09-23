import { Controller, Get } from '@nestjs/common';

@Controller('test-validation')
export class TestController {
  @Get()
  test() {
    return { message: 'Tag validation module is loaded!' };
  }
}