import { Injectable } from "@angular/core";
import * as childProcess from "child_process";
// If you import a module but never use any of the imported values other than as TypeScript types,
// the resulting javascript file will look as if you never imported the module at all.
import { ipcRenderer, remote, shell, webFrame } from "electron";
import * as fs from "fs";
import { BehaviorSubject } from "rxjs";
import { v4 as uuidv4 } from "uuid";
import { IpcRequest } from "../../../common/models/ipc-request";
import { IpcResponse } from "../../../common/models/ipc-response";
import { ValueRequest } from "../../../common/models/value-request";
import { ValueResponse } from "../../../common/models/value-response";

@Injectable({
  providedIn: "root",
})
export class ElectronService {
  private readonly _windowMaximizedSrc = new BehaviorSubject(false);
  private readonly _windowMinimizedSrc = new BehaviorSubject(false);

  ipcRenderer: typeof ipcRenderer;
  webFrame: typeof webFrame;
  remote: typeof remote;
  shell: typeof shell;
  childProcess: typeof childProcess;
  fs: typeof fs;

  public readonly windowMaximized$ = this._windowMaximizedSrc.asObservable();
  public readonly windowMinimized$ = this._windowMinimizedSrc.asObservable();
  public readonly isWin = process.platform === "win32";
  public readonly isMac = process.platform === "darwin";
  public readonly isLinux = process.platform === "linux";

  get isElectron(): boolean {
    return !!(window && window.process && window.process.type);
  }

  get locale(): string {
    return this.remote.app.getLocale().split("-")[0];
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
      .setVisualZoomLevelLimits(0.6, 3)
      .then(() =>
        console.log("Zoom levels have been set between 60% and 300%")
      )
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
  }

  public getVersionNumber() {
    return this.remote.app.getVersion();
  }

  minimizeWindow() {
    this.remote.getCurrentWindow().minimize();
  }

  maximizeWindow() {
    this.remote.getCurrentWindow().maximize();
  }

  unmaximizeWindow() {
    this.remote.getCurrentWindow().unmaximize();
  }

  hideWindow() {
    this.remote.getCurrentWindow().hide();
  }

  restartApplication() {
    this.remote.app.relaunch();
    this.remote.app.quit();
  }

  closeWindow() {
    this.remote.getCurrentWindow().close();
    this.remote.app.quit();
  }

  public showNotification(title: string, options?: NotificationOptions) {
    const myNotification = new Notification(title, options);
  }

  public async sendIpcValueMessage<TIN, TOUT>(
    channel: string,
    value: TIN
  ): Promise<TOUT> {
    const request: ValueRequest<TIN> = {
      value,
      responseKey: uuidv4(),
    };

    const response = await this.sendIPCMessage<
      ValueRequest<TIN>,
      ValueResponse<TOUT>
    >(channel, request);

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
