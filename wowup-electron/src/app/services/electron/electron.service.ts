import { Injectable } from "@angular/core";
import * as childProcess from "child_process";
import { APP_UPDATE_CHECK_END, APP_UPDATE_CHECK_START } from "common/constants";
// If you import a module but never use any of the imported values other than as TypeScript types,
// the resulting javascript file will look as if you never imported the module at all.
import { ipcRenderer, remote, Settings, shell, webFrame } from "electron";
import * as fs from "fs";
import { BehaviorSubject } from "rxjs";
import { v4 as uuidv4 } from "uuid";
import { IpcRequest } from "../../../common/models/ipc-request";
import { IpcResponse } from "../../../common/models/ipc-response";
import { ValueRequest } from "../../../common/models/value-request";
import { ValueResponse } from "../../../common/models/value-response";
import { AppOptions } from "../../../common/wowup/app-options";
import * as minimist from "minimist";

@Injectable({
  providedIn: "root",
})
export class ElectronService {
  private readonly _windowMaximizedSrc = new BehaviorSubject(false);
  private readonly _windowMinimizedSrc = new BehaviorSubject(false);
  private readonly _ipcEventReceivedSrc = new BehaviorSubject("");

  ipcRenderer: typeof ipcRenderer;
  webFrame: typeof webFrame;
  remote: typeof remote;
  shell: typeof shell;
  childProcess: typeof childProcess;
  fs: typeof fs;

  public readonly windowMaximized$ = this._windowMaximizedSrc.asObservable();
  public readonly windowMinimized$ = this._windowMinimizedSrc.asObservable();
  public readonly ipcEventReceived$ = this._ipcEventReceivedSrc.asObservable();
  public readonly isWin = process.platform === "win32";
  public readonly isMac = process.platform === "darwin";
  public readonly isLinux = process.platform === "linux";
  public readonly appOptions: AppOptions;

  public get isElectron(): boolean {
    return !!(window && window.process && window.process.type);
  }

  public get locale(): string {
    return this.remote.app.getLocale().split("-")[0];
  }

  public get loginItemSettings() {
    return this.remote.app.getLoginItemSettings();
  }

  public set loginItemSettings(settings: Settings) {
    this.remote.app.setLoginItemSettings(settings);
  }

  constructor() {
    // Conditional imports
    if (!this.isElectron) {
      return;
    }

    console.log("Platform", process.platform, this.isLinux);

    this.ipcRenderer = window.require("electron").ipcRenderer;
    this.webFrame = window.require("electron").webFrame;
    this.remote = window.require("electron").remote;
    this.shell = window.require("electron").shell;

    this.childProcess = window.require("child_process");
    this.fs = window.require("fs");

    this.ipcRenderer.on(APP_UPDATE_CHECK_START, () => {
      this._ipcEventReceivedSrc.next(APP_UPDATE_CHECK_START);
    });

    this.ipcRenderer.on(APP_UPDATE_CHECK_END, () => {
      this._ipcEventReceivedSrc.next(APP_UPDATE_CHECK_END);
    });

    const currentWindow = this.remote?.getCurrentWindow();

    currentWindow?.on("minimize", () => {
      this._windowMinimizedSrc.next(true);
    });

    currentWindow?.on("restore", () => {
      this._windowMinimizedSrc.next(false);
    });

    currentWindow?.on("maximize", () => {
      this._windowMaximizedSrc.next(true);
    });

    currentWindow?.on("unmaximize", () => {
      this._windowMaximizedSrc.next(false);
    });

    this._windowMaximizedSrc.next(currentWindow?.isMaximized() || false);

    currentWindow?.webContents
      .setVisualZoomLevelLimits(1, 3)
      .then(() => console.log("Zoom levels have been set between 100% and 300%"))
      .catch((err) => console.error(err));

    currentWindow.webContents.on("zoom-changed", (event, zoomDirection) => {
      let currentZoom = currentWindow.webContents.getZoomFactor();
      let zoomStep = 1.1;
      let zoomMin = 0.6;
      let zoomMax = 3;

      if (zoomDirection === "in") {
        let value = currentZoom * zoomStep;
        value = Math.min(value, zoomMax);
        // setting the zoomFactor comes at a cost, this early return greatly improves performance
        if (value == zoomMax) {
          return;
        }
        currentWindow.webContents.zoomFactor = value;
        return;
      }
      if (zoomDirection === "out") {
        let value = currentZoom / zoomStep;
        value = Math.max(value, zoomMin);
        // setting the zoomFactor comes at a cost, this early return greatly improves performance
        if (value == zoomMin) {
          return;
        }
        currentWindow.webContents.zoomFactor = value;
      }
    });

    this.appOptions = (<any>minimist(this.remote.process.argv.slice(1), {
      boolean: ["hidden", "quit"],
    })) as AppOptions;

    console.log("appOptions", this.appOptions);
  }

  public getVersionNumber() {
    return this.remote.app.getVersion();
  }

  public minimizeWindow() {
    this.remote.getCurrentWindow().minimize();
  }

  public maximizeWindow() {
    this.remote.getCurrentWindow().maximize();
  }

  public unmaximizeWindow() {
    this.remote.getCurrentWindow().unmaximize();
  }

  public hideWindow() {
    this.remote.getCurrentWindow().hide();
  }

  public restartApplication() {
    this.remote.app.relaunch();
    this.quitApplication();
  }

  public quitApplication() {
    this.remote.app.quit();
  }

  public closeWindow() {
    this.remote.getCurrentWindow().close();
    this.remote.app.quit();
  }

  public showNotification(title: string, options?: NotificationOptions) {
    return new Notification(title, options);
  }

  public async sendIpcValueMessage<TIN, TOUT>(channel: string, value: TIN): Promise<TOUT> {
    const request: ValueRequest<TIN> = {
      value,
      responseKey: uuidv4(),
    };

    const response = await this.sendIPCMessage<ValueRequest<TIN>, ValueResponse<TOUT>>(channel, request);

    return response.value;
  }

  public sendIPCMessage<TIN extends IpcRequest, TOUT extends IpcResponse>(
    channel: string,
    request: TIN
  ): Promise<TOUT> {
    return new Promise((resolve, reject) => {
      this.ipcRenderer.once(request.responseKey, (_evt: any, arg: TOUT) => {
        if (arg.error) {
          return reject(arg.error);
        }
        resolve(arg);
      });
      this.ipcRenderer.send(channel, request);
    });
  }

  public async invoke(channel: string, ...args: any[]): Promise<any> {
    return await this.ipcRenderer.invoke(channel, ...args);
  }
}
