﻿using CommandLine;
using Serilog;
using System;
using System.Linq;
using WowUp.WPF.Models.WowUp;

namespace WowUp.WPF.Utilities
{
    public static class StartupHelper
    {
        public static void SetOptions()
        {
            var args = Environment.GetCommandLineArgs().Skip(1);
            Parser.Default.ParseArguments<StartupOptions>(args)
                .WithParsed(
                    options => StartupOptions = options)
                .WithNotParsed(
                    errors => Log.Error(string.Join("\r\n", errors.Select(x => x.ToString()).ToArray())));
        }
        public static StartupOptions StartupOptions { get; private set; }
    }
}
