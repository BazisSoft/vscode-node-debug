/**
 * Класс, реализующий "умные" операции с моделью.
 * В частности - замену материалов разной толщины
 * с перестроением модели.
 */
declare interface ModelTransformer {
    /**
     * Применить изменения
     */
    Apply(undo: Undo3D);
    /**
     * Максимальный выступ панели, при котором соединение считается угловым
     */
    CornerMaxOffset: number;
    /**
     * Максимальное расстояние для определения стыка
     * @default 0.5;
     */
    ConnectionMaxDistance: number;
    /**
     * Добавить изменение толщины панели
     * @param panel Изменяемая панель
     * @param thicknessDifference Разница между новой и старой толщинами
     */
    AddPanelThicknessChange(panel: Panel, thicknessDifference: number);
    /**
     * Добавить изменение толщины пластика панели
     * @param plastic Изменяемый пластик
     * @param thicknessDifference Разница между новой и старой толщинами
     * @param panel Панель, которой принадлежит пластик
     */
    SetPlasticChange(plastic: PanelPlastic, thicknessDifference: number, panel: Panel);
    /**
     * Вычислить все объекты рядом с панелью
     * @param auto Автоматически определить направление изменения толщины
     */
    Compute(auto: boolean);
    /**
     * Очистить всю информацию обо всех объектах
     */
    ClearChangesInfo(): void;

}

declare function NewModelTransformer(): ModelTransformer;

/**
 * Редактор значения на экране
 */
declare interface ValueEditor {
    /**
     * Отображаемое значение
     */
    Value: number;
    /**
     * Видимость объекта
     */
    Visible: boolean;
    /**
     * Запрет редактирования значения
     */
    Readonly: boolean;
    /**
     * Позиция на экране
     */
    Position: Point;
}

interface Action3D {
    /**
     * Обработчик изменения ValueEditor
     */
    OnValueChange: Function;
    /**
     * Обработчик отрисовки. Предупреждение: это событие вызывается очень часто,
     * в связи с чем не рекомендуется делать сложные вычисления,
     * которые могут тормозить работу программы
     */
    OnDraw: Function;
    /**
     * Текущий выбранный редактор значения
     */
    ValueEditor: ValueEditor;
    /**
     * Возвращает ребро, на которое указывает курсор мыши
     */
    Edge: Edge3;
    /**
     * Позиция курсора
     */
    MousePos: Point2;
    /**
     * Показывает, был ли отменен скрипт
     */
    Canceled: boolean;
    /**
     * Загрузить проект из файла
     */
    LoadProject(filename: string): ProjectFile;
    /**
     * Сохранить проект в файл
     */
    SaveProject(filename: string, project: ProjectFile);

    /**
     * Замена фурнитуры
     * @param oldList список имен заменяемых 3д-объектов
     * @param newList список фурнитуры для замены
     * @param objList список объектов, среди которых будет произведена замена
     */
    ReplaceFurniture(oldList: string[], newList: InfFurniture[], objList: Object3[]);
}

interface Undo3D{
    /**
     * Начать отменяемую операцию
     */
    BeginOper(name: string);
    /**
     * Закончить отменяемую операцию
     */
    EndOper(name: string);
    /**
     * Закончить и отменить последнюю отменяемую операцию
     */
    EndAndUndoOper();
}

declare function NewValueEditor(value?: number): ValueEditor;

declare interface AdvancedJoint {
    /**
     * Схема крепежа
     */
    Scheme: ParamFastener;
    /**
     * Точка начала монтирования
     */
    StartPoint: Vector;
    /**
     * Точка конца монтирования
     */
    EndPoint: Vector;
    /**
     * Вектор "верха" блока схемы
     * (локальная ось Y будущего блока схемы)
     */
    UpDir: Vector;
    /**
     * Блок крепежа, установленного по схеме
     */
    readonly JointBlock: Block;
    /**
     * Смонтировать схему на стык
     * @param TempScheme схема крепежа. По умолчанию this.Scheme
     */
    Mount(TempScheme?): boolean;
}


declare interface ProjectFile {
    Items: Array<ProjectFile>;
    Count: number;
    Name: string;
    FullName: string;
    IsFileProject: boolean;
}

interface Model3D {
    DS: Designer;
}

declare function NewAdvancedJoint(): AdvancedJoint;

declare interface FurnitureInfo {
    /**
     * Параметры крепежа
     */
    Params: ParamFastener;
}

declare interface ParamFastener {
    /**
     * способ базирования крепежа
     */
    DatumMode;
    /**
     * Имя крепежа
     */
    Name: string;
    /**
     * Толщина первого объекта
     */
    Thickness1: number;
    /**
     * Толщина второго объекта
     */
    Thickness2: number;
    IsValid(): boolean;
}

interface InFurniture {
    FurnInfo: InfFurniture;
}

interface InfFurniture {
    GetInfo(): FurnitureInfo;
}

declare interface Designer {
    Render: Renderer;
    /**
     * Найти ребро по текйщей позиции на экране
     * @param Root Объект, среди ребер которого будет производиться поиск
     * @param CursorPos Позиция на экране
     * @param SearchDistance Погрешность (отступ от ребра) при поиске (в мм)
     */
    FindEdge(Root: Object3, CursorPos: Point2, SearchDistance: number): Edge3;
}

declare interface Renderer {

}

declare interface Point2 {
    X: number;
    Y: number;
}

declare interface TWPCatalog{
    id: number;
    name: string;
    modelFolderId: number;
    shared: boolean;
}

declare interface TWPFileItem {
    id: number;
    name: string;
    folder: boolean;
}

declare interface TWPMaterial {
    id: number;
    catalogId: number;
    name: string;
    texture: string;
    bumpTexture: string;
    sizex: number;
    sizey: number;
    offsetx: number;
    offsety: number;
    angle: number;
    transparency: number;
    reflection: number;
    ambient: number;
    specular: number;
    shininess: number;
}

declare interface TWebPlanner{

    // authentication
    Login(UserName: string, Password: string): string;
    UseToken(Token: string): boolean;

    // catalogs
    GetCatalogs(): TWPCatalog[];
    GetCatalog(Id: number): TWPCatalog;
    NewCatalog(Name: string): TWPCatalog;
    DeleteCatalog(Id: number): void;

    // materials
    GetMaterials(CatalogId: number): TWPMaterial[];
    UpdateMaterial(Material: TWPMaterial): number;
    UpdateMaterialTexture(Material: TWPMaterial, TextureImageFile: string): TWPMaterial;
    UpdateMaterialBumpMap(Material: TWPMaterial, NormalImageFile: string): TWPMaterial;

    // files
    GetFileItem(Id: number): TWPFileItem;
    GetFileItems(FolderId: number): TWPFileItem[];
    NewFolder(Name: string, parentFolder: number): TWPFileItem;
    UploadModel(FolderOrFileId: number, FileName: string): TWPFileItem;
    UpdateFileItem(Id: number, NewName: string, NewArticle?: string): TWPFileItem;
    SetFileThumnail(Id: number, ImageFileName: string, Resize?: boolean): string;
    DeleteFileItem(Id: number);
}

/**
 * @param Server - имя сервера. По умолчанию https://www.wigwam3d.com
 */
declare function NewWebPlanner(Server?: string): TWebPlanner;