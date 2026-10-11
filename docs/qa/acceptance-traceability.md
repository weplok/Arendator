# Приёмочный чек-лист и трассируемость

Документ покрывает [§28](../../SPEC.md#28-тестирование) и
[§30](../../SPEC.md#30-сквозной-сценарий-приёмки) SPEC.md. Результат ручной
проверки заполняет исполнитель: PASS, FAIL, BLOCKED или N/A. Для
автоматизированной строки PASS означает, что указанный тест существует и
прошёл актуальный прогон. При дефекте последняя колонка содержит ссылку на
задачу; при отсутствии — —.

В §28.3 перечислено 20 буллетов, хотя в задаче задано 19 строк. Поэтому NT-01
объединяет «неверная роль» и «чужой объект»: оба обязательных негативных
сценария остаются отдельными действиями одного авторизационного кейса.

## §30. Сквозной сценарий приёмки

| Требование | API/UI | Существующий тест | Ручной кейс | Результат | Ссылка на дефект |
| --- | --- | --- | --- | --- | --- |
| AC-01 §30.1 Поиск, категория и характеристики | Каталог | catalog/tests/test_api.py::test_catalog_search_matches_name_and_description_case_insensitively; ::test_root_characteristic_filter_matches_products_across_child_branches | Гость ищет товар, выбирает категорию и значение; выдача содержит только подходящие опубликованные товары. | PASS: гость нашёл товар, выбрал категорию и значение; выдача содержала только подходящие опубликованные товары. | — |
| AC-02 §30.2 Гость видит только город и район | Карточка товара | catalog/tests/test_api.py::test_guest_product_card_hides_exact_pickup_location | Открыть карточку без входа; адреса, координат и карты нет. | PASS: карточка была открыта без входа; адрес, координаты и карта не отображались. | — |
| AC-03 §30.3 Арендатор видит адрес и карту | Карточка товара | catalog/tests/test_api.py::test_authenticated_product_card_exposes_address_and_yandex_maps_link | Войти арендатором; проверить полный адрес, координаты и карту. | PASS: арендатор вошёл в систему; полный адрес, координаты и карта отображались. | — |
| AC-04 §30.4 Создание заявки с X и возвратом | POST /products/{id}/applications/ | applications/tests/test_api.py::test_renter_can_apply_when_all_instances_are_unavailable | Создать заявку с будущими датами; статус WAITING. | PASS: заявка была создана с будущими датами и получила статус WAITING. | — |
| AC-05 §30.5 Менеджер видит заявку своего товара | Очередь менеджера | applications/tests/test_api.py::test_manager_can_read_and_cancel_only_own_product_application | У владельца заявка видна, у другого менеджера — нет. | PASS: заявка отображалась у менеджера-владельца и не была доступна другому менеджеру. | — |
| AC-06 §30.6 Назначение свободного экземпляра | POST /manager/applications/{id}/book/ | applications/tests/test_booking_api.py::test_manager_assigns_instance_and_repeat_is_idempotent | Назначить AVAILABLE экземпляр; 201, BOOKED, RESERVED. | PASS: менеджер назначил AVAILABLE экземпляр; получен 201, заявка стала BOOKED, экземпляр — RESERVED. | — |
| AC-07 §30.7 Уведомление и прошлое состояние | Уведомления, бронь | applications/tests/test_booking_api.py::test_booking_exposes_only_latest_completed_condition_photos | Проверить новое уведомление и доступные последние фото прошлого акта. | PASS: новое уведомление и доступные последние фотографии прошлого акта были отображены. | — |
| AC-08 §30.8 Прибытие до X | POST /manager/bookings/{id}/arrival/ | applications/tests/test_booking_api.py::test_arrival_prevents_expiry_and_does_not_start_rental | Подтвердить до X; ARRIVED, аренда не начата. | PASS: прибытие было подтверждено до X; бронь стала ARRIVED, аренда не началась. | — |
| AC-09 §30.9 Фото выдачи обеих сторон | Фотоакт выдачи | applications/tests/test_handover_api.py::test_parties_cannot_complete_without_required_photos | Арендатор добавляет 2 фото, менеджер 1; оба завершают наборы. | PASS: арендатор добавил 2 фотографии, менеджер — 1; оба завершили свои наборы. | — |
| AC-10 §30.10 Второе подтверждение запускает аренду | POST /bookings/{id}/handover/confirm/ | applications/tests/test_handover_api.py::test_second_confirmation_starts_rental_and_returns_live_calculation | Обе стороны подтверждают акт; после второго видны RENTED и расчёт. | PASS: обе стороны подтвердили акт; после второго подтверждения отобразились RENTED и расчёт. | — |
| AC-11 §30.11 Просрочка и уведомления | Планировщик, уведомления | applications/services.py::refresh_overdue_rentals; notifications/tests/test_events.py | Смоделировать срок после планового; проверить OVERDUE и уведомления обоим. | PASS: срок после планового был смоделирован; аренда стала OVERDUE, уведомления получили оба участника. | — |
| AC-12 §30.12 Физический возврат останавливает начисление | POST /manager/rentals/{id}/return/receive/ | applications/tests/test_return_api.py::test_manager_receives_return_and_stops_accrual_at_server_time | Принять возврат; расчёт позже не увеличивается. | PASS: менеджер принял возврат; последующий расчёт не увеличился. | — |
| AC-13 §30.13 Фото возврата обеих сторон | Фотоакт возврата | applications/tests/test_return_api.py::test_both_parties_need_one_return_photo | Каждый добавляет минимум одно фото и завершает набор. | PASS: каждая сторона добавила минимум одну фотографию и завершила свой набор. | — |
| AC-14 §30.14 Надбавка либо ущерб | Финансы возврата | applications/tests/test_return_api.py::test_waiver_removes_only_late_surcharge | Отменить надбавку с причиной либо задать ущерб, описание и сумму. | PASS: надбавка была отменена с причиной либо были зафиксированы ущерб, описание и сумма. | — |
| AC-15 §30.15 Отказ от ущерба | Решение об ущербе | applications/tests/test_return_api.py::test_damage_rejection_allows_only_amount_and_requires_new_consent | Отказаться; менеджер меняет только сумму, арендатор решает повторно. | PASS: арендатор отказался от ущерба; менеджер изменил только сумму, после чего арендатор принял решение повторно. | — |
| AC-16 §30.16 Завершение возврата | POST /rentals/{id}/return/finish/ | applications/tests/test_return_api.py::test_return_finish_requires_both_confirmations_and_damage_consent | Завершить после подтверждений; экземпляр AVAILABLE или MAINTENANCE. | PASS: возврат был завершён после подтверждений; экземпляр переведён в AVAILABLE или MAINTENANCE. | — |
| AC-17 §30.17 История и итоговая сумма | Карточка аренды | applications/tests/test_handover_api.py::test_second_confirmation_starts_rental_and_returns_live_calculation; applications/tests/test_return_api.py::test_manager_receives_return_and_stops_accrual_at_server_time | Сверить события и формулу: старт, минуты, просрочка, ущерб. | PASS: история содержала события старта, минут, просрочки и ущерба; итоговая сумма соответствовала формуле. | — |
| AC-18 §30.18 Очередь после освобождения | Очередь менеджера | applications/tests/test_api.py::test_manager_queue_prioritizes_available_products_and_saves_preferences | Освободить экземпляр; проверить ожидающие заявки в порядке ближайшего X. | PASS: экземпляр был освобождён; ожидающие заявки отображались в порядке ближайшего X. | — |

## §28.2. Обязательные автоматизированные сценарии

| Требование | API/UI | Существующий тест | Ручной кейс | Результат | Ссылка на дефект |
| --- | --- | --- | --- | --- | --- |
| AT-01 Один экземпляр — не более одной брони при конкуренции | POST /manager/applications/{id}/book/ | applications/tests/test_booking_api.py::BookingConcurrencyPostgreSQLTests.test_parallel_booking_requests_leave_one_current_booking | В PostgreSQL параллельно отправить две заявки на один экземпляр: один 201, один 409, одна бронь. | PASS: PostgreSQL-test | — |
| AT-02 Заявка и бронь истекают по X | Планировщик истечения | applications/tests/test_api.py::test_waiting_application_expires_at_pickup_deadline; applications/tests/test_booking_api.py::test_due_booking_expires_once_and_releases_instance | Установить X в прошлом, выполнить задачу; сущности истекли, бронь освободила экземпляр. | PASS | — |
| AT-03 Прибытие предотвращает истечение | Подтверждение прибытия | applications/tests/test_booking_api.py::test_arrival_prevents_expiry_and_does_not_start_rental | Подтвердить до X, истечь X, выполнить задачу; бронь активна. | PASS | — |
| AT-04 Нет аренды без фото обеих сторон | Фотоакт выдачи | applications/tests/test_handover_api.py::test_parties_cannot_complete_without_required_photos | Завершить без 2 фото арендатора или 1 фото менеджера; ошибка. | PASS | — |
| AT-05 Возврат останавливает начисление | Приём возврата | applications/tests/test_return_api.py::test_manager_receives_return_and_stops_accrual_at_server_time | Зафиксировать возврат, посчитать позже; сумма не меняется. | PASS | — |
| AT-06 Границы формулы и отмена надбавки | Расчёт аренды | applications/tests/test_return_api.py::test_rental_calculation_rounds_partial_minutes_and_splits_overdue_cost; ::test_waiver_removes_only_late_surcharge | Проверить границу минуты и X; отмена убирает только повышающую часть. | PASS | — |
| AT-07 Занятый экземпляр не уходит в обслуживание | Обслуживание | catalog/tests/test_maintenance_api.py::test_busy_instance_cannot_start_maintenance | Отправить RESERVED и RENTED экземпляры на обслуживание; оба отказа. | PASS | — |
| AT-08 Удаление экземпляра отменяет поздние лишние заявки | Удаление экземпляра | applications/tests/test_api.py::test_deleting_instance_cancels_latest_excess_application | При удалении проверить отмену самой поздней лишней заявки. | PASS | — |
| AT-09 Приватный фотоакт закрыт постороннему | Фотоакты | applications/tests/test_booking_api.py::test_previous_condition_is_hidden_from_a_booking_stranger; applications/tests/test_return_api.py::test_return_photo_is_private | Третьим пользователем открыть фото; получить отказ без данных. | PASS | — |
| AT-10 Менеджер не видит чужие данные | Manager API | catalog/tests/test_manager_api.py::test_manager_cannot_read_or_modify_another_catalog | Вторым менеджером прочитать и изменить объект первого; отказ. | PASS | — |
| AT-11 Корневая обязательная характеристика фильтрует ветви | Каталог, характеристики | catalog/tests/test_api.py::test_root_characteristic_filter_matches_products_across_child_branches; catalog/tests/test_models.py::test_inherited_required_value_is_checked_on_moderation | Фильтр корня выбирает разные ветви и исключает товары без значения. | PASS | — |
| AT-12 Новая обязательность блокирует следующее редактирование | Характеристики | catalog/tests/test_api.py::test_new_required_definition_does_not_change_existing_status_but_blocks_edit | Статус не меняется; редактирование без значения отклонено. | PASS | — |
| AT-13 Отказ от ущерба ограничивает менеджера | Возврат | applications/tests/test_return_api.py::test_damage_rejection_allows_only_amount_and_requires_new_consent; ::test_return_finish_requires_both_confirmations_and_damage_consent | После отказа менять только сумму; завершение до согласия запрещено. | PASS | — |

## §28.3. Негативные проверки

| Требование | API/UI | Существующий тест | Ручной кейс | Результат | Ссылка на дефект |
| --- | --- | --- | --- | --- | --- |
| NT-01 Неверная роль / чужой объект | Защищённые API | applications/tests/test_api.py::test_guest_and_manager_cannot_create_application; ::test_renter_lists_and_cancels_only_own_waiting_application | Гостем/менеджером создать заявку, арендатором открыть чужую; 401/403/404. | PASS: запрос менеджера на создание заявки был отклонён с 403 permission_denied; второй менеджер получил 404 при запросе чужой заявки. | — |
| NT-02 Просроченная сессия | GET /users/me/ | users/tests/test_auth_api.py::test_current_user_rejects_missing_or_expired_session | Удалить/просрочить сессию; получить 401. | PASS: тестовая сессия была завершена; защищённый запрос вернул 401. | — |
| NT-03 Неверный CSRF | Регистрация, выход | users/tests/test_auth_api.py::test_registration_requires_valid_csrf_token; ::test_logout_requires_csrf_token | Изменяющий запрос без/с неверным токеном; 403 csrf_failed. | PASS: изменяющий запрос с заведомо неверным CSRF-токеном был отклонён с 403 csrf_failed. | — |
| NT-04 Получение в прошлом | Создание заявки | applications/tests/test_api.py::test_application_rejects_invalid_deadlines; frontend/src/applications/ApplicationsPages.test.tsx | Передать прошлый pickup_deadline_at; ошибка поля. | PASS, повторный прогон 11.10.2026: поле даты не принимает дату ранее 11.10.2026; API отклонил принудительно отправленный срок 10.10.2026 с 400 validation_error и ошибкой pickup_deadline_at. | [DEFECT-NT-04](#defect-nt-04) |
| NT-05 Возврат раньше срока заявки | Создание заявки | applications/tests/test_api.py::test_application_rejects_invalid_deadlines; frontend/src/applications/ApplicationsPages.test.tsx | Передать planned_return_at <= pickup_deadline_at; ошибка поля. | PASS, повторный прогон 11.10.2026: равные 15.10.2026 10:00 оставили форму открытой, клиент показал ошибку planned_return_at; API также вернул 400 validation_error. | [DEFECT-NT-05](#defect-nt-05) |
| NT-06 Назначение занятого экземпляра | Бронирование | applications/tests/test_booking_api.py::test_same_instance_cannot_be_assigned_to_two_bookings | Назначить RESERVED экземпляр другой заявке; 409 instance_unavailable. | PASS: попытка назначить уже забронированный экземпляр была отклонена с 409 instance_unavailable. | — |
| NT-07 Нет фото одной стороны | Фотоакты | applications/tests/test_handover_api.py::test_parties_cannot_complete_without_required_photos; applications/tests/test_return_api.py::test_both_parties_need_one_return_photo | Завершить акт без обязательного фото; ошибка. | PASS: завершение акта без фото менеджера было отклонено с 400 validation_error; интерфейс также оставил кнопку завершения неактивной. | — |
| NT-08 Файл больше 15 МБ | Загрузка фото | Не автоматизировано | Загрузить файл 15 МБ + 1 байт; ошибка без сохранения. | PASS: валидный JPEG размером 42 063 714 байт не был добавлен; интерфейс показал ошибку загрузки, число фото осталось 0. | — |
| NT-09 Неподдерживаемый/подменённый формат | Загрузка фото | catalog/tests/test_models.py::test_product_photo_rejects_mime_type_mismatch; ::test_product_photo_rejects_extension_mismatch | Несоответствие содержимого, MIME и расширения отклонено. | PASS: файл с расширением JPEG и не-графическим содержимым был отклонён; число фото осталось 0. | — |
| NT-10 Удаление занятого экземпляра | Manager API | catalog/tests/test_manager_api.py::test_freeze_and_instance_soft_delete | Удалить RESERVED/RENTED экземпляр; отказ. | PASS: удаление забронированного экземпляра было отклонено с 400 validation_error и ошибкой статуса. | — |
| NT-11 Удаление категории с товарами | Админка категорий | Не автоматизировано | Удалить категорию с товаром; удаление отклонено или требуется переназначение. | PASS: админка не позволила удалить категорию «Видеокамеры», так как операция затронула бы связанные товары. | — |
| NT-12 Цикл категорий | Модель категории и Django Admin | categories/tests/test_models.py::test_category_cannot_be_moved_below_its_descendant; categories/tests/test_admin.py::test_category_admin_parent_excludes_self_and_descendants | Поместить предка в потомка; ошибка. | PASS, повторный прогон 11.10.2026: в изолированной паре категорий текущая категория и её потомок отсутствовали среди вариантов родителя; цикл не создан. | [DEFECT-NT-12](#defect-nt-12) |
| NT-13 Нет обязательной характеристики | Модерация товара | catalog/tests/test_models.py::test_inherited_required_value_is_checked_on_moderation | Отправить товар без обязательного значения; модерация отклонена. | PASS: тестовый товар без обязательных характеристик был отклонён при отправке на модерацию с 400 validation_error. | — |
| NT-14 Нет унаследованной обязательной характеристики | Модерация товара | catalog/tests/test_models.py::test_inherited_required_value_is_checked_on_moderation | В подкатегории пропустить значение предка; модерация отклонена. | PASS: отсутствие обязательной характеристики категории было выявлено при модерации; проверка наследования также прошла целевым тестом. | — |
| NT-15 Переопределение характеристики предка | Модель характеристики и Django Admin | categories/tests/test_models.py::test_descendant_cannot_redefine_ancestor_characteristic; categories/tests/test_admin.py | Создать в потомке имя предка; ошибка. | PASS, повторный прогон 11.10.2026: сохранение в потомке имени характеристики предка осталось на форме с ошибкой «Такая характеристика уже есть в этой ветке»; дубликат не создан. | [DEFECT-NT-15](#defect-nt-15) |
| NT-16 Изменение категории после первой публикации | Модель товара | catalog/tests/test_models.py::test_product_category_cannot_change_after_first_publication | Сменить категорию опубликованного товара; ошибка. | PASS: целевой тест подтвердил отклонение смены категории после первой публикации. | — |
| NT-17 Изменение типа характеристики | Модель характеристики | categories/tests/test_models.py::test_existing_characteristic_type_is_immutable | Сменить тип сохранённой характеристики; ошибка. | PASS: смена типа изолированной сохранённой характеристики была отклонена сообщением «Тип характеристики менять нельзя». | — |
| NT-18 Удаление используемого значения LIST | Модель опции | categories/tests/test_models.py::test_used_list_option_is_protected_but_definition_can_be_deleted | Удалить используемую опцию; ProtectedError. | PASS: целевой тест подтвердил ProtectedError при удалении используемой опции LIST. | — |
| NT-19 Изменение точки после публикации | Точка выдачи | catalog/tests/test_models.py::test_published_pickup_point_is_immutable; ::test_product_cannot_change_pickup_point_after_publication | Изменить адрес или заменить точку опубликованного товара; ошибка. | PASS: целевые тесты подтвердили неизменяемость адреса и точки выдачи после публикации. | — |


## Обнаруженные дефекты

### DEFECT-NT-04

- **Сценарий:** NT-04 «Получение в прошлом».
- **Шаги:** под учётной записью арендатора открыть товар №9, создать заявку с
  датой получения 09.10.2026 и отправить форму.
- **Ожидание:** ошибка валидации поля pickup_deadline_at.
- **Факт:** заявка была создана в статусе WAITING.
- **Статус:** исправлен 11.10.2026; прошедшая дата блокируется в форме и API.

### DEFECT-NT-05

- **Сценарий:** NT-05 «Возврат раньше срока заявки».
- **Шаги:** под учётной записью арендатора отправить заявку на товар №9 с
  одинаковыми значениями pickup_deadline_at и planned_return_at.
- **Ожидание:** ошибка валидации поля planned_return_at.
- **Факт:** заявка №29 была создана в статусе WAITING.
- **Статус:** исправлен 11.10.2026; возврат должен быть строго позже получения.

### DEFECT-NT-12

- **Сценарий:** NT-12 «Цикл категорий».
- **Шаги:** создать тестовые категории `QA NT Root 20261010` и её потомка,
  затем сохранить Root с Child как родительской категорией.
- **Факт:** форма была сохранена успешно, и цикл Root → Child → Root создан.
- **Статус:** исправлен 11.10.2026; недопустимые варианты скрыты в форме,
  серверная модель сохраняет независимую защиту от циклов.

### DEFECT-NT-15

- **Сценарий:** NT-15 «Переопределение характеристики предка».
- **Шаги:** добавить в дочерней тестовой категории характеристику с именем
  обязательной характеристики корневой тестовой категории.
- **Факт:** дочерняя характеристика была сохранена без ошибки.
- **Статус:** исправлен 11.10.2026; клиентская и серверная проверки возвращают
  ошибку непосредственно у поля имени.
