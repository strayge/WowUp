import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { MatSort } from "@angular/material/sort";
import { MatTableDataSource } from "@angular/material/table";
import { TranslateService } from "@ngx-translate/core";
import * as _ from "lodash";
import { Subscription } from "rxjs";
import { filter, map } from "rxjs/operators";
import { GetAddonListItem } from "../../business-objects/get-addon-list-item";
import {
  AddonDetailComponent,
  AddonDetailModel,
} from "../../components/addon-detail/addon-detail.component";
import { InstallFromUrlDialogComponent } from "../../components/install-from-url-dialog/install-from-url-dialog.component";
import { WowClientType } from "../../models/warcraft/wow-client-type";
import { AddonSearchResult } from "../../models/wowup/addon-search-result";
import { ColumnState } from "../../models/wowup/column-state";
import { ElectronService } from "../../services";
import { AddonService } from "../../services/addons/addon.service";
import { SessionService } from "../../services/session/session.service";
import { WarcraftService } from "../../services/warcraft/warcraft.service";
import { WowUpService } from "../../services/wowup/wowup.service";
import { MatMenuTrigger } from "@angular/material/menu";
import { MatCheckboxChange } from "@angular/material/checkbox";

@Component({
  selector: "app-get-addons",
  templateUrl: "./get-addons.component.html",
  styleUrls: ["./get-addons.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GetAddonsComponent implements OnInit, OnDestroy {
  @Input("tabIndex") tabIndex: number;

  @ViewChild(MatSort) sort: MatSort;
  @ViewChild("table", { read: ElementRef }) table: ElementRef;
  @ViewChild("columnContextMenuTrigger") columnContextMenu: MatMenuTrigger;

  private _subscriptions: Subscription[] = [];
  private _isSelectedTab: boolean = false;
  private _lazyLoaded: boolean = false;

  public dataSource = new MatTableDataSource<GetAddonListItem>([]);
  public activeSort = "downloadCount";
  public activeSortDirection = "desc";

  columns: ColumnState[] = [
    { name: "name", display: "Addon", visible: true },
    { name: "downloadCount", display: "Downloads", visible: true, allowToggle: true },
    { name: "releasedAt", display: "Released At", visible: true, allowToggle: true },
    { name: "author", display: "Author", visible: true, allowToggle: true },
    { name: "providerName", display: "Provider", visible: true, allowToggle: false },
    { name: "status", display: "Status", visible: true },
  ];

  public get displayedColumns(): string[] {
    return this.columns.filter((col) => col.visible).map((col) => col.name);
  }

  public get defaultAddonChannelKey() {
    return this._wowUpService.getClientDefaultAddonChannelKey(
      this._sessionService.selectedClientType
    );
  }

  public get defaultAddonChannel() {
    return this._wowUpService.getDefaultAddonChannel(
      this._sessionService.selectedClientType
    );
  }

  public query = "";
  public isBusy = true;
  public selectedClient = WowClientType.None;
  public contextMenuPosition = { x: "0px", y: "0px" };
  public selectedCategory = '';
  public categories;

  constructor(
    private _addonService: AddonService,
    private _sessionService: SessionService,
    private _dialog: MatDialog,
    private _wowUpService: WowUpService,
    private _cdRef: ChangeDetectorRef,
    private _translateService: TranslateService,
    public electronService: ElectronService,
    public warcraftService: WarcraftService
  ) {
    _sessionService.selectedHomeTab$.subscribe((tabIndex) => {
      this._isSelectedTab = tabIndex === this.tabIndex;
      if (!this._isSelectedTab) {
        return;
      }
      this.setPageContextText();
      this.lazyLoad();
    });
  }

  ngOnInit(): void {
    const sortOrder = this._wowUpService.getAddonsSortOrder;
    if(sortOrder){
      this.activeSort = sortOrder.name;
      this.activeSortDirection = sortOrder.direction;
    }

    const columnStates = this._wowUpService.getAddonsHiddenColumns;
    this.columns.forEach((col) => {
      if (!col.allowToggle) {
        return;
      }

      const state = _.find(columnStates, (cs) => cs.name === col.name);
      if (state) {
        col.visible = state.visible;
      }
    });
    this._addonService.getCategories().then(result => this.categories = ["All"].concat(result));
  }

  ngOnDestroy() {
    this._subscriptions.forEach((sub) => sub.unsubscribe());
    this._subscriptions = [];
  }

  onSortChange(): void {
    if (this.table) {
      this.table.nativeElement.scrollIntoView({ behavior: "smooth" });
    }

    this._wowUpService.getAddonsSortOrder = {
      name: this.sort.active,
      direction: this.sort.start || "",
    };
  }

  onStatusColumnUpdated() {
    this._cdRef.detectChanges();
  }

  public onHeaderContext(event: MouseEvent) {
    event.preventDefault();
    this.updateContextMenuPosition(event);
    this.columnContextMenu.menuData = {
      columns: this.columns.filter((col) => col.allowToggle),
    };
    this.columnContextMenu.menu.focusFirstItem("mouse");
    this.columnContextMenu.openMenu();
  }

  private updateContextMenuPosition(event: MouseEvent) {
    this.contextMenuPosition.x = event.clientX + "px";
    this.contextMenuPosition.y = event.clientY + "px";
  }

  public onColumnVisibleChange(event: MatCheckboxChange, column: ColumnState) {
    const col = this.columns.find((col) => col.name === column.name);
    col.visible = event.checked;
    this._wowUpService.getAddonsHiddenColumns = [...this.columns];
  }

  private lazyLoad() {
    if (this._lazyLoaded) {
      return;
    }

    this._lazyLoaded = true;

    const selectedClientSubscription = this._sessionService.selectedClientType$
      .pipe(
        map((clientType) => {
          this.selectedClient = clientType;
          this.loadPopularAddons(this.selectedClient);
        })
      )
      .subscribe();
    const addonRemovedSubscription = this._addonService.addonRemoved$
      .pipe(
        map((event: string) => {
          this.onRefresh();
        })
      )
      .subscribe();

    const channelTypeSubscription = this._wowUpService.preferenceChange$
      .pipe(filter((change) => change.key === this.defaultAddonChannelKey))
      .subscribe((change) => {
        this.onSearch();
      });

    const dataSourceSub = this.dataSource.connect().subscribe((data) => {
      this.setPageContextText();
    });

    this._subscriptions = [
      selectedClientSubscription,
      addonRemovedSubscription,
      channelTypeSubscription,
      dataSourceSub,
    ];
  }

  private setDataSource(items: GetAddonListItem[]) {
    this.dataSource.data = items;
    this.dataSource.sortingDataAccessor = (
      item: GetAddonListItem,
      prop: string
    ) => {
      if (prop === "releasedAt") {
        return item.getLatestFile(this.defaultAddonChannel)?.releaseDate;
      }
      let value = _.get(item, prop);
      return typeof value === "string" ? value.toLowerCase() : value;
    };
    this.dataSource.sort = this.sort;
  }

  onInstallFromUrl() {
    const dialogRef = this._dialog.open(InstallFromUrlDialogComponent);
    dialogRef.afterClosed().subscribe((result) => {
      console.log("The dialog was closed");
    });
  }

  onClientChange() {
    this._sessionService.selectedClientType = this.selectedClient;
  }

  onRefresh() {
    this.loadPopularAddons(this.selectedClient);
  }

  onClearSearch() {
    this.query = "";
    this.onSearch();
  }

  async onSearch() {
    if (!this.query && (!this.selectedCategory || this.selectedCategory == 'All')) {
      await this.loadPopularAddons(this.selectedClient);
      return;
    }

    this.isBusy = true;

    let searchResults = await this._addonService.search(
      this.query,
      this.selectedClient,
      this.selectedCategory,
    );

    this.setDataSource(this.formatAddons(searchResults));
    this.isBusy = false;
    this._cdRef.detectChanges();
  }

  openDetailDialog(listItem: GetAddonListItem) {
    const data: AddonDetailModel = {
      searchResult: listItem.searchResult,
    };

    const dialogRef = this._dialog.open(AddonDetailComponent, {
      data,
    });

    dialogRef.afterClosed().subscribe();
  }

  private async loadPopularAddons(clientType: WowClientType) {
    if (clientType === WowClientType.None) {
      return;
    }

    this.isBusy = true;

    this._addonService.getFeaturedAddons(clientType).subscribe({
      next: (addons) => {
        const listItems = this.formatAddons(addons);
        this.setDataSource(listItems);
        this.isBusy = false;
      },
      error: (err) => {
        console.error(err);
      },
    });
  }

  private formatAddons(addons: AddonSearchResult[]): GetAddonListItem[] {
    return addons.map((addon) => new GetAddonListItem(addon));
  }

  private setPageContextText() {
    const length = this.dataSource.data?.length;
    const contextStr = length
      ? this._translateService.instant(
          "PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.SEARCH_RESULTS",
          { count: length }
        )
      : "";

    this._sessionService.setContextText(this.tabIndex, contextStr);
  }
}
