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
     * Загрузить проект из файла
     */
    LoadProject(filename: string): ProjectFile;
    /**
     * Сохранить проект в файл
     */
    SaveProject(filename: string, project: ProjectFile);
}

declare function NewValueEditor(value?: number): ValueEditor;

declare interface JointInfo {
    /**
     * Первый объект стыка
     */
    Object1: Object3,
    /**
     * Второй обЪект стыка
     */
    Object2: Object3,
    /**
     * Тип стыка
     */
    JointType: number,
    /**
     * Базовая точка стыка
     */
    BasisPoint: Vector;
    /**
     * Объект стыка
     */
    JointExtrusion: Extrusion;
    /**
     * Отрисовка стыка.
     * @param Color цвет стыка
     * @param linesOnly рисовать только линии
     */
    Draw(Color: number, linesOnly?: boolean): void;
    SetEdgesOwner(newOwner: List3D): void;
    /**
     * проверка пересечения объекта стыка с лучом на экране. Результат - дистанция до стыка.
     * Если пересечения нет, возвращает -1
     * @param x
     * @param y
     */
    RayIntersect(x: number, y: number): number;
}


declare interface ConnectionsInfo {
    Joints: Array<JointInfo>,
    JointCount: number,
    Created: boolean
}

declare function NewJointInfo(Obj1: Object3, Obj2: Object3): ConnectionsInfo;

declare interface AdvancedJoint {
    /**
     * информация о стыке
     */
    readonly Info: JointInfo,
    /**
     * Схема крепежа
     */
    Scheme: ParamFastener,
    /**
     * Блок крепежа, установленного по схеме
     */
    readonly JointBlock: Block,
    /**
     * Выбрать ребро для монтирования
     */
    SelectEdge(edge: Edge3): boolean,
    /**
     * Изменить направление монтирования
     */
    RevertEdgeDirection(edge: Edge3): boolean,
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

declare function NewAdvancedJoint(Info: JointInfo): AdvancedJoint;

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