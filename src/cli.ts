#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();
program
  .name('night-shift')
  .description('re:Invent の予定を夜のうちに整えるローカルエージェント')
  .version('0.1.0');

program.parseAsync(process.argv);
